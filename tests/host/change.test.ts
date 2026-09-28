// Plan changes end to end (docs/design/plan-mode.md): `edit`, `create` and `delete` parse, list in
// --effects with a hash of their text, never touch a file in a dry run or under --fake-exec, and
// apply (and re-apply) in a real run.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { Section } from "../../src/contracts.gen.js";
import { preprocess } from "../../src/preprocess/index.js";
import { runSkope, type SkopeEvent } from "../acceptance/lib/cli.js";
import { skillMd } from "../preprocess/helpers.js";

const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validEvent = ajv.compile(JSON.parse(readFileSync(new URL("../../contracts/event.schema.json", import.meta.url), "utf8")));

const EDIT = ["- **edit** `a.txt`", "  ```old", "  old thing", "  ```", "  ```new", "  new thing", "  ```"];
const CREATE = ["- **create** `d/new.md`", "  ```new", "  hello", "  ```"];

function plan(body: string[], files: Record<string, string> = { "a.txt": "one\nold thing\n" }): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "skope-plan-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [p, c] of Object.entries(files)) writeFileSync(join(dir, p), c);
  const path = join(dir, "plan.md");
  writeFileSync(
    path,
    `---\nname: plan\ndescription: a test plan\n---\nA skope skill.\n\`\`\`skope\nformat: 1\n\`\`\`\n\n## Main\nChange things.\n\n${body.join("\n")}\n`,
  );
  return { dir, path };
}

const of = (events: SkopeEvent[], event: string) => events.filter((e) => e.event === event);
const checked = (events: SkopeEvent[]) => {
  for (const e of events) expect(validEvent(e), JSON.stringify(validEvent.errors)).toBe(true);
  return events;
};

describe("parsing", () => {
  const body = (md: string) => {
    const r = preprocess(md);
    if ("errors" in r) throw new Error(JSON.stringify(r.errors));
    return (r.program.sections["s:main"] as Section).body;
  };

  test("edit, create and delete become change statements with their text", () => {
    const b = body(skillMd("## Main", ...EDIT, ...CREATE, "- **delete** `old.txt` · else skip", "- **stop**"));
    expect(b[0]).toMatchObject({ change: { op: "edit", path: "a.txt", old: "old thing\n", new: "new thing\n", all: false }, else: null });
    expect(b[1]).toMatchObject({ change: { op: "create", path: "d/new.md", new: "hello\n" } });
    expect(b[2]).toMatchObject({ change: { op: "delete", path: "old.txt" }, else: { skip: {} } });
  });

  test("`· all` on an edit", () => {
    const b = body(skillMd("## Main", "- **edit** `a.txt` · all", "  ```old", "  x", "  ```", "  ```new", "  y", "  ```", "- **stop**"));
    expect(b[0]).toMatchObject({ change: { all: true } });
  });

  test.each([
    ["a variable in the path", ["- **edit** `{dir}/a.txt`", "  ```old", "  x", "  ```", "  ```new", "  y", "  ```"]],
    ["no new block", ["- **edit** `a.txt`", "  ```old", "  x", "  ```"]],
    ["blocks in the wrong order", ["- **edit** `a.txt`", "  ```new", "  y", "  ```", "  ```old", "  x", "  ```"]],
    ["an empty old block", ["- **edit** `a.txt`", "  ```old", "  ```", "  ```new", "  y", "  ```"]],
    ["prose under an edit", ["- **edit** `a.txt`", "", "  a note", "", "  ```old", "  x", "  ```", "  ```new", "  y", "  ```"]],
    ["a block under delete", ["- **delete** `a.txt`", "  ```new", "  y", "  ```"]],
    ["`· all` on create", ["- **create** `a.txt` · all", "  ```new", "  y", "  ```"]],
  ])("E-GRAMMAR: %s", (_, lines) => {
    const r = preprocess(skillMd("## Main", ...lines, "- **stop**"));
    expect("errors" in r && r.errors.map((e) => e.code)).toContain("E-GRAMMAR");
  });
});

describe("runs", () => {
  test("--effects lists each change with a hash of its text, so changing the text changes the approval hash", async () => {
    const a = plan([...EDIT, "- **stop**"]);
    const b = plan([...EDIT.map((l) => l.replace("new thing", "other thing")), "- **stop**"]);
    const ea = await runSkope([a.path, "--effects"]);
    const eb = await runSkope([b.path, "--effects"]);
    expect(ea.stderr).toMatch(/do {3}edit a\.txt #[0-9a-f]{12}/);
    const hash = (r: { stdout: string }) => JSON.parse(r.stdout.trim().split("\n").at(-1) as string).effects_hash;
    expect(hash(ea)).not.toBe(hash(eb));
  });

  test("a dry run changes no file; a real run applies, and a re-run finds it already applied", async () => {
    const { dir, path } = plan([...EDIT, ...CREATE, "- **delete** `gone.txt`", "- **stop**"], {
      "a.txt": "one\nold thing\n",
      "gone.txt": "x\n",
    });
    await runSkope([path, "--approve"]);
    const dry = checked((await runSkope([path, "--dry-run"])).events);
    expect(of(dry, "would_do").map((e) => e.cmd)).toEqual(["edit a.txt", "create d/new.md", "delete gone.txt"]);
    expect(of(dry, "change")).toHaveLength(0);
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("one\nold thing\n");

    const run = checked((await runSkope([path, "--apply"])).events);
    expect(of(run, "change").map((e) => [e.op, e.result])).toEqual([
      ["edit", "applied"],
      ["create", "applied"],
      ["delete", "applied"],
    ]);
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("one\nnew thing\n");
    expect(readFileSync(join(dir, "d/new.md"), "utf8")).toBe("hello\n");
    expect(existsSync(join(dir, "gone.txt"))).toBe(false);
    // Each change sits between its effect_start and effect_end.
    expect(run.map((e) => e.event).slice(1, 4)).toEqual(["effect_start", "change", "effect_end"]);

    const again = checked((await runSkope([path, "--apply"])).events);
    expect(of(again, "change").map((e) => e.result)).toEqual(["already_applied", "already_applied", "already_applied"]);
    expect(again.at(-1)).toMatchObject({ outcome: "stopped" });
  });

  test("a failed change goes to failure handling and leaves the file alone", async () => {
    const { dir, path } = plan([...EDIT, "- **stop**"], { "a.txt": "nothing to match\n" });
    await runSkope([path, "--approve"]);
    const r = checked((await runSkope([path, "--apply"])).events);
    expect(of(r, "change")[0]).toMatchObject({ result: "failed", message: expect.stringContaining("isn't in the file") });
    expect(r.at(-1)).toMatchObject({ outcome: "handoff", reason: "command_failed" });
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("nothing to match\n");
  });

  test("under --fake-exec a change is faked by its descriptor and no file changes", async () => {
    const { dir, path } = plan([...EDIT, "- **stop**"]);
    const fakes = join(dir, "c.yaml");
    writeFileSync(fakes, JSON.stringify({ "edit a.txt": { exit: 0 } }));
    const r = checked((await runSkope([path, "--apply", "--fake-exec", fakes])).events);
    expect(r.at(-1)).toMatchObject({ outcome: "stopped" });
    expect(of(r, "change")).toHaveLength(0);
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("one\nold thing\n");
  });
});
