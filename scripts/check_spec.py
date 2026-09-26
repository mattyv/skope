#!/usr/bin/env python3
"""Checks on SPEC.md and PLAN.md that CI runs on every push.

Usage:
  check_spec.py docs            error codes defined, JSON examples valid, fixtures and
                                contracts/error-codes.json match the spec
  check_spec.py codes           regenerate contracts/error-codes.json from SPEC §7.1
  check_spec.py mermaid DIR     write every Mermaid diagram to DIR as .mmd files
  check_spec.py coverage        every error code is named in a test (reference check;
                                each code is enforced once its milestone closes)
  check_spec.py milestones      every closed milestone's acceptance tests run and pass,
                                with none skipped, todo or expected to fail

The coverage check is a reference check only: it proves a code is named in
a test, not that the test exercises it. Milestone completion is proven by the
milestones check, which runs the tests (PLAN.md §5).
"""
import json
import os
import pathlib
import subprocess
import tempfile
import re
import sys
import textwrap

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEC = ROOT / "docs" / "SPEC.md"
DOCS = [SPEC, ROOT / "docs" / "PLAN.md", ROOT / "README.md"]
CODE = re.compile(r"`([EW]-[A-Z]+(?:-[A-Z]+)*)`")
UNTESTABLE = {"E-INTERNAL", "E-IO"}  # SPEC §12.2: can't be triggered on purpose
TEST_FILE = re.compile(r"\.(test|spec)\.(ts|mts|js|mjs)$|\.dfy$")
ACCEPTANCE = ROOT / "tests" / "acceptance"
# Tests that name codes only as sample data, never exercising them.
NOT_COVERAGE = {"tests/contracts.test.ts", "tests/golden.test.ts"}


FIXTURE_DIRS = {"disk-full": "fixtures", "cert-expiry": "fixtures", "error-triage": "fixtures"}
CODES_FILE = ROOT / "contracts" / "error-codes.json"


def spec_code_table() -> list[dict]:
    """Rows of the error and warning tables in SPEC §7.1, in order."""
    spec = SPEC.read_text()
    rows = []
    for line in spec.splitlines():
        m = re.match(r"^\| `([EW]-[A-Z-]+)` \|(.*)\|\s*$", line)
        if not m:
            continue
        # Split on unescaped pipes only: meanings contain `yes \| no`.
        cells = [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", m.group(2))]
        if m.group(1).startswith("E-"):
            rows.append({"code": m.group(1), "stage": cells[0], "meaning": cells[1]})
        else:
            rows.append({"code": m.group(1), "stage": "warning", "meaning": cells[0]})
    return rows


def codes_json() -> str:
    return json.dumps(spec_code_table(), indent=2, ensure_ascii=False) + "\n"


def check_fixtures() -> list[str]:
    """Each example skill in the spec's appendices matches its fixture file."""
    errors = []
    spec = SPEC.read_text()
    for block in re.findall(r"````markdown\n(.*?)````", spec, re.S):
        m = re.search(r"^name: ([a-z0-9-]+)", block, re.M)
        if not m or m.group(1) not in FIXTURE_DIRS:
            continue
        path = ROOT / FIXTURE_DIRS[m.group(1)] / m.group(1) / "SKILL.md"
        if not path.is_file():
            errors.append(f"{path.relative_to(ROOT)} is missing (copy it from the SPEC appendix)")
        elif path.read_text() != block:
            errors.append(f"{path.relative_to(ROOT)} differs from its SPEC appendix")
    return errors


def defined_codes() -> set[str]:
    return {r["code"] for r in spec_code_table()}


def closed_milestones() -> list[str]:
    """tests/acceptance/CLOSED: one milestone per line, like M2. Lines starting
    with # are comments."""
    f = ACCEPTANCE / "CLOSED"
    if not f.is_file():
        return []
    return [l.strip().upper() for l in f.read_text().splitlines() if l.strip() and not l.strip().startswith("#")]


def check_docs() -> list[str]:
    errors = []
    defined = defined_codes()
    if not defined:
        errors.append("docs/SPEC.md: no error code table found (§7.1)")
    for doc in DOCS:
        text = doc.read_text()
        for code in sorted(set(CODE.findall(text)) - defined):
            errors.append(f"{doc.name}: {code} is used but not defined in SPEC §7.1")
        for n, block in enumerate(re.findall(r"```json\n(.*?)```", text, re.S), 1):
            try:
                json.loads(textwrap.dedent(block).replace("…", "x"))
            except json.JSONDecodeError as e:
                errors.append(f"{doc.name}: JSON example {n} doesn't parse: {e}")
    errors += check_fixtures()
    if not CODES_FILE.is_file() or CODES_FILE.read_text() != codes_json():
        errors.append("contracts/error-codes.json is stale: run scripts/check_spec.py codes")
    return errors


def write_mermaid(out: pathlib.Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    count = 0
    for doc in DOCS:
        for n, block in enumerate(re.findall(r"```mermaid\n(.*?)```", doc.read_text(), re.S), 1):
            (out / f"{doc.stem}-{n}.mmd").write_text(textwrap.dedent(block))
            count += 1
    print(f"wrote {count} diagrams to {out}")


def check_coverage() -> list[str]:
    files = [p for p in (ROOT / "tests").rglob("*")
             if p.is_file() and TEST_FILE.search(p.name) and p.relative_to(ROOT).as_posix() not in NOT_COVERAGE]
    # Only lines that actually exercise a code count: a test's title or an
    # assertion. A code named in passing, e.g. in a comment or as sample
    # data outside an expect(...), doesn't prove anything is tested.
    lines = [line for p in files for line in p.read_text(errors="ignore").splitlines()
             if re.search(r"\b(test|it|describe)\s*\(|\bexpect\s*\(", line)]
    text = "\n".join(lines)
    closed = set(closed_milestones())
    errors, later = [], 0
    for row in spec_code_table():
        c = row["code"]
        if c in UNTESTABLE or c in text:
            continue
        if due_at(row) in closed:
            errors.append(f"{c} has no test, and its milestone ({due_at(row)}) is closed (SPEC §12.2)")
        else:
            later += 1
    if later:
        print(f"coverage: {later} codes have no test yet; each is enforced once its milestone closes")
    return errors


# Warnings that come from lint rather than from running.
LINT_WARNINGS = {"W-ASK-NO-CONTEXT", "W-NO-GUIDANCE", "W-SECTION-UNREACHED"}


def due_at(row: dict) -> str:
    """The milestone by which a code must have a test (SPEC §12.3)."""
    c = row["code"]
    if row["stage"] in ("parse", "lint") or c in LINT_WARNINGS:
        return "M2"
    return "M4"


def check_milestones() -> list[str]:
    """Each closed milestone's acceptance tests, in tests/acceptance/<m>/, are
    run with Vitest. Every test must pass: none skipped, todo, or expected to
    fail, and there must be at least one."""
    errors = []
    for m in closed_milestones():
        d = ACCEPTANCE / m.lower()
        with tempfile.TemporaryDirectory() as tmp:
            out = pathlib.Path(tmp) / "results.json"
            run = subprocess.run(
                ["npx", "vitest", "run", str(d.relative_to(ROOT)), "--reporter=json", f"--outputFile={out}", "--passWithNoTests"],
                cwd=ROOT, capture_output=True, text=True, env={**os.environ, "CI": "1"},
            )
            if not out.is_file():
                errors.append(f"{m}: vitest produced no results: {run.stderr.strip()[-300:]}")
                continue
            results = [t for f in json.loads(out.read_text())["testResults"] for t in f["assertionResults"]]
        if not results:
            errors.append(f"{m} is closed but tests/acceptance/{m.lower()}/ has no tests")
        for t in results:
            if t["status"] != "passed":
                errors.append(f"{m}: {' > '.join(t['ancestorTitles'] + [t['title']])} is {t['status']}, not passed")
        # A test.fails whose body fails is reported as "passed", so expected
        # failures are caught in the source instead.
        for p in d.rglob("*"):
            if p.is_file() and TEST_FILE.search(p.name):
                for n, line in enumerate(p.read_text(errors="ignore").splitlines(), 1):
                    if re.search(r"\.fails\b", line):
                        errors.append(f"{p.relative_to(ROOT)}:{n}: {m} is closed, so this can't be an expected failure")
    return errors


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "codes":
        CODES_FILE.write_text(codes_json())
        print(f"wrote {CODES_FILE.relative_to(ROOT)} ({len(spec_code_table())} codes)")
        return 0
    if cmd == "mermaid" and len(sys.argv) == 3:
        write_mermaid(pathlib.Path(sys.argv[2]))
        return 0
    if cmd == "docs":
        errors = check_docs()
    elif cmd == "coverage":
        errors = check_coverage()
    elif cmd == "milestones":
        errors = check_milestones()
    else:
        print(__doc__)
        return 2
    for e in errors:
        print(f"error: {e}")
    if not errors:
        print(f"{cmd}: ok")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
