#!/usr/bin/env python3
"""Checks on SPEC.md and PLAN.md that CI runs on every push.

Usage:
  check_spec.py docs            error codes defined, JSON examples valid, fixtures and
                                contracts/error-codes.json match the spec
  check_spec.py codes           regenerate contracts/error-codes.json from SPEC §7.1
  check_spec.py mermaid DIR     write every Mermaid diagram to DIR as .mmd files
  check_spec.py coverage        every error code is named in a test file (reference check;
                                each code is enforced once its milestone closes)
  check_spec.py milestones      closed milestones have no expected failures or skips

The coverage check is a reference check only: it proves a code is named in
a test file, not that a test exercises it. Milestone completion is proven by
the milestones check plus the tests themselves passing (PLAN.md §5).
"""
import json
import pathlib
import re
import sys
import textwrap

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = [ROOT / "SPEC.md", ROOT / "PLAN.md"]
CODE = re.compile(r"`([EW]-[A-Z]+(?:-[A-Z]+)*)`")
UNTESTABLE = {"E-INTERNAL", "E-IO"}  # SPEC §12.2: can't be triggered on purpose
TEST_FILE = re.compile(r"\.test\.(ts|mts|js|mjs)$|\.dfy$")
ACCEPTANCE = ROOT / "tests" / "acceptance"
NOT_PASSING = re.compile(r"\b(test|it|describe)\.(fails|skip|todo|only)\b|\b(xit|xdescribe|xtest)\(|\{:test\s*:skip")


FIXTURE_DIRS = {"disk-full": "fixtures", "cert-expiry": "fixtures", "error-triage": "fixtures-next"}
CODES_FILE = ROOT / "contracts" / "error-codes.json"


def spec_code_table() -> list[dict]:
    """Rows of the error and warning tables in SPEC §7.1, in order."""
    spec = (ROOT / "SPEC.md").read_text()
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
    spec = (ROOT / "SPEC.md").read_text()
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
    spec = (ROOT / "SPEC.md").read_text()
    return set(re.findall(r"^\| `([EW]-[A-Z-]+)`", spec, re.M))


def check_docs() -> list[str]:
    errors = []
    defined = defined_codes()
    if not defined:
        errors.append("SPEC.md: no error code table found (§7.1)")
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
    tests = ROOT / "tests"
    if not tests.is_dir():
        print("coverage: no tests/ directory yet, skipping")
        return []
    files = [p for p in tests.rglob("*") if p.is_file() and TEST_FILE.search(p.name)]
    text = "\n".join(p.read_text(errors="ignore") for p in files)
    closed_file = ACCEPTANCE / "CLOSED"
    closed = set(closed_file.read_text().split()) if closed_file.is_file() else set()
    due, later = [], []
    for row in spec_code_table():
        c = row["code"]
        if c in UNTESTABLE or c in text:
            continue
        (due if due_at(row) in closed else later).append(c)
    if later:
        print(f"coverage: {len(later)} codes have no test yet; each is enforced once its milestone closes")
    return [f"{c} has no test, and its milestone ({due_at(r)}) is closed (SPEC §12.2)"
            for r in spec_code_table() for c in [r["code"]] if c in due]


# Warnings that come from lint rather than from running.
LINT_WARNINGS = {"W-ASK-NO-CONTEXT", "W-NO-GUIDANCE", "W-SECTION-UNREACHED"}


def due_at(row: dict) -> str:
    """The milestone by which a code must have a test (SPEC §12.3)."""
    c = row["code"]
    if "SCORE" in c or "RUBRIC" in c:
        return "M7"
    if row["stage"] in ("parse", "lint") or c in LINT_WARNINGS:
        return "M2"
    return "M4"


def check_milestones() -> list[str]:
    """Closed milestones are listed one per line in tests/acceptance/CLOSED.
    Each has its acceptance tests in tests/acceptance/<milestone>/, and every
    one of them must be a normal test: no expected failures, skips or todos."""
    closed_file = ACCEPTANCE / "CLOSED"
    if not closed_file.is_file():
        print("milestones: none closed yet")
        return []
    errors = []
    for m in (l.strip() for l in closed_file.read_text().splitlines()):
        if not m or m.startswith("#"):
            continue
        d = ACCEPTANCE / m.lower()
        tests = [p for p in d.rglob("*") if p.is_file() and TEST_FILE.search(p.name)] if d.is_dir() else []
        if not tests:
            errors.append(f"{m} is closed but tests/acceptance/{m.lower()}/ has no test files")
        for p in tests:
            for n, line in enumerate(p.read_text(errors="ignore").splitlines(), 1):
                if NOT_PASSING.search(line):
                    errors.append(f"{p.relative_to(ROOT)}:{n}: {m} is closed, so this can't be an expected failure or skip")
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
