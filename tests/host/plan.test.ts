// Plans (docs/design/plan-mode.md): `kind: plan`, the static diff, file pins and E-PLAN-STALE,
// --from, progress lines, and the fuller failure detail a plan's handoff record keeps.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { unifiedDiff } from "../../src/host/plan.js";
import { preprocess } from "../../src/preprocess/index.js";
import { runSkope } from "../acceptance/lib/cli.js";
import { skillMd } from "../preprocess/helpers.js";

const PLAN = [
  "## Change",
  "Make the edit.",
  "",
  "- **edit** `a.txt`",
  "  ```old",
  "  old thing",
  "  ```",
  "  ```new",
  "  new thing",
  "  ```",
  "- **check** `grep -q CHECK a.txt` succeeds · else [Fix]",
  "- **then** [Tests]",
  "",
  "## Tests",
  "- **run** `echo tests pass`",
  "- **stop**",
  "",
  "## Fix",
  "- **hand off**",
];

/** A git repo with a plan and a config that keeps approvals beside it. */
function setup(check = "new thing", block = "kind: plan\n") {
  const dir = mkdtempSync(join(tmpdir(), "skope-plan-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "line one\nold thing\nline three\n");
  const path = join(dir, "plan.md");
  writeFileSync(
    path,
    `---\nname: plan\ndescription: a test plan\n---\nA skope skill.\n\`\`\`skope\nformat: 1\n${block}\`\`\`\n\n${PLAN.join("\n").replace("CHECK", `"${check}"`)}\n`,
  );
  const config = join(dir, "config.yaml");
  writeFileSync(config, `approvals: beside-skill\nstate_dir: ${dir}/state\nask:\n  backend: fake\npager:\n  command: "cat > /dev/null"\n`);
  const skope = (...args: string[]) => runSkope([path, ...args, "--config", config]);
  return { dir, path, skope };
}

describe("kind: plan", () => {
  test("gives longer default limits, which explicit limits still override", () => {
    const limits = (block: string) => {
      const r = preprocess(skillMd("## Main", "- **stop**").replace("format: 1\n", `format: 1\n${block}`));
      if ("errors" in r) throw new Error(JSON.stringify(r.errors));
      return r.program;
    };
    expect(limits("kind: plan\n")).toMatchObject({
      kind: "plan",
      limits: { run_timeout_ms: 600_000, do_timeout_ms: 600_000, deadline_ms: 3_600_000 },
    });
    expect(limits("kind: plan\nlimits:\n  run_timeout: 20s\n").limits.run_timeout_ms).toBe(20_000);
    expect(limits("")).not.toHaveProperty("kind");
    expect(limits("kind: skill\n").limits.run_timeout_ms).toBe(30_000);
  });

  test("E-FRONTMATTER: any other kind", () => {
    const r = preprocess(skillMd("## Main", "- **stop**").replace("format: 1\n", "format: 1\nkind: runbook\n"));
    expect("errors" in r && r.errors.map((e) => e.code)).toEqual(["E-FRONTMATTER"]);
  });
});

describe("the static diff", () => {
  test("--effects --diff prints what every change would do, whatever path a run would take", async () => {
    const { skope } = setup("never there");
    const r = await skope("--effects", "--diff");
    expect(r.code).toBe(0);
    const diff = "--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n line one\n-old thing\n+new thing\n line three\n";
    expect(r.stderr).toContain(diff);
    expect(JSON.parse(r.stdout.trim().split("\n").at(-1) as string).diff).toBe(diff);
  });

  test("unifiedDiff: new files, deleted files and separate hunks", () => {
    expect(unifiedDiff("n.txt", null, "a\n")).toBe("--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+a\n");
    expect(unifiedDiff("d.txt", "a\n", null)).toBe("--- a/d.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-a\n");
    const before = `${Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n")}\n`;
    const after = before.replace("l2\n", "L2\n").replace("l17\n", "L17\n");
    expect(unifiedDiff("f", before, after).match(/^@@/gm)).toHaveLength(2);
  });

  test("E-USAGE: --diff without --effects", async () => {
    const { skope } = setup();
    expect((await skope("--diff", "--apply")).code).toBe(40);
  });
});

describe("approval pins the files", () => {
  test("a run refuses a file someone changed after approval (E-PLAN-STALE), but not the plan's own changes", async () => {
    const { dir, skope } = setup();
    await skope("--approve");
    const approval = JSON.parse(readFileSync(join(dir, "plan.approval.json"), "utf8"));
    expect(Object.keys(approval.files)).toEqual(["a.txt"]);
    expect(approval.files["a.txt"]).toHaveLength(2); // as approved, and after the edit

    const first = await skope("--apply", "--no-page");
    expect(first.events.at(-1)).toMatchObject({ outcome: "stopped" });
    // The file is now as the plan left it: running again is fine.
    expect((await skope("--apply", "--no-page")).events.at(-1)).toMatchObject({ outcome: "stopped" });

    writeFileSync(join(dir, "a.txt"), "someone else's edit\n");
    const stale = await skope("--apply", "--no-page");
    expect(stale.code).toBe(40);
    expect(stale.events.find((e) => e.event === "error")).toMatchObject({ code: "E-PLAN-STALE" });
    // A dry run changes nothing, so it still runs.
    expect((await skope("--dry-run")).code).not.toBe(40);
  });
});

describe("--from and the fix loop", () => {
  test("a failed check hands off with the command's output and log; --from resumes past it", async () => {
    const { skope } = setup("not there yet");
    await skope("--approve");
    const r = await skope("--apply", "--no-page");
    expect(r.events.at(-1)).toMatchObject({ outcome: "handoff" });
    const record = r.events.find((e) => e.event === "handoff_record")?.record as { detail: Record<string, unknown> };
    expect(record.detail).toMatchObject({ cmd: 'grep -q "not there yet" a.txt', exit: 1, stdout_tail: "" });
    expect(existsSync(record.detail.log as string)).toBe(true);
    expect(readFileSync(record.detail.log as string, "utf8")).toContain('$ grep -q "not there yet" a.txt\nexit: 1');

    const resumed = await skope("--apply", "--no-page", "--from", "Tests");
    expect(resumed.events.find((e) => e.event === "run_start")).toMatchObject({ from: "Tests" });
    expect(resumed.events.filter((e) => e.event === "change")).toHaveLength(0);
    expect(resumed.events.at(-1)).toMatchObject({ outcome: "stopped" });
  });

  test("E-USAGE: --from a section that isn't there, or with --effects", async () => {
    const { skope } = setup();
    expect((await skope("--lint", "--from", "Nowhere")).events.find((e) => e.event === "error")).toMatchObject({ code: "E-USAGE" });
    expect((await skope("--effects", "--from", "Tests")).code).toBe(40);
  });

  test("--progress prints a line per command as it starts", async () => {
    const { skope } = setup();
    await skope("--approve");
    const r = await skope("--apply", "--no-page", "--progress");
    expect(r.stderr).toContain("skope: [1] do edit a.txt\n");
    expect(r.stderr).toContain('skope: [2] check grep -q "new thing" a.txt\n');
  });
});
