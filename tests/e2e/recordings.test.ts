// Replays recorded real plan approvals (tests/e2e/README.md). Each tests/e2e/recordings/NAME/
// fixture.json holds what a real Claude Code or Codex session gave the approval hook, and the
// transcript as it was when the hook ran and when the plan ran. Replaying one checks that skope
// still accepts that tool's real approval: the hook records it, and the run's own check passes.
// Commands and changes are faked, so a replay runs nothing from the recorded plan.
//
// The last test records a simulated session, imports it with scripts/import-recording.mjs and
// replays it, so the record → import → replay pipeline is tested even with no recordings.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { edit, plan, sessions, world } from "./lib.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RECORDINGS = join(ROOT, "tests", "e2e", "recordings");

interface Fixture {
  tool: "claude" | "codex";
  session_cwd: string;
  hook: Record<string, unknown>;
  transcript_at_hook: string | null;
  transcript_at_apply: string | null;
  plan_path: string;
  plan: string;
  files: Record<string, string | null>;
}

/** Replays `fixture`: the hook, then the run. Returns what each said. */
function replay(fixture: Fixture) {
  const w = world(Object.fromEntries(Object.entries(fixture.files).filter((e): e is [string, string] => e[1] !== null)));
  const agent = fixture.tool === "claude" ? w.claude : w.codex;
  const fill = <T>(v: T): T =>
    JSON.parse(JSON.stringify(v).split("{{AGENT}}").join(agent).split("{{REPO}}").join(w.repo).split("{{HOME}}").join(w.root)) as T;
  const f = fill(fixture);
  mkdirSync(dirname(f.plan_path), { recursive: true });
  writeFileSync(f.plan_path, f.plan);
  mkdirSync(f.session_cwd, { recursive: true });
  const transcript = String(f.hook.transcript_path);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, f.transcript_at_hook ?? "");
  const hook = w.skope(["--plan-approved"], w.repo, JSON.stringify(f.hook));
  if (f.transcript_at_apply !== null) writeFileSync(transcript, f.transcript_at_apply);

  // Fake every command and change the plan could run, so nothing recorded runs for real.
  const effects = w.skope([f.plan_path, "--effects"], f.session_cwd);
  const commands = JSON.parse(effects.stdout.trim().split("\n").at(-1) as string).commands as { cmd: string }[];
  const fakes = join(w.root, "fakes.yaml");
  writeFileSync(fakes, JSON.stringify(Object.fromEntries(commands.map((c) => [c.cmd.replace(/ #[0-9a-f]{64}$/, ""), { exit: 0 }]))));
  const run = w.skope([f.plan_path, "--apply", "--no-page", "--config", w.config, "--fake-exec", fakes], f.session_cwd);
  return { hook, run };
}

const fixtures = existsSync(RECORDINGS) ? readdirSync(RECORDINGS).filter((n) => existsSync(join(RECORDINGS, n, "fixture.json"))) : [];

describe("recorded real sessions", () => {
  test.skipIf(fixtures.length === 0)("there are recordings to replay", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });
  test.each(fixtures)("%s: the real approval is accepted", (name) => {
    const { hook, run } = replay(JSON.parse(readFileSync(join(RECORDINGS, name, "fixture.json"), "utf8")) as Fixture);
    expect(hook.stderr).not.toContain("didn't");
    expect(run.error?.code).toBeUndefined();
  });
});

describe("the record → import → replay pipeline", () => {
  test.each(["claude", "codex"] as const)("%s", (tool) => {
    const w = world({ "src/a.ts": "export const a = 1;\n" });
    const rec = mkdtempSync(join(tmpdir(), "skope-rec-"));
    (w.env as Record<string, string>).SKOPE_RECORD = rec;
    const s = sessions[tool](w, "recorded");
    s.write(plan("recorded", `## Change\n${edit("src/a.ts", "export const a = 1;\n", "export const a = 2;\n")}\n- **stop**`));
    s.present();
    s.approve();
    expect(s.apply().code).toBe(0);
    const stages = readdirSync(rec).map((n) => n.replace(/^.*-(hook|apply)-\d+\.json$/, "$1"));
    expect(stages.sort()).toEqual(["apply", "hook"]);

    const out = mkdtempSync(join(tmpdir(), "skope-fixtures-"));
    execFileSync(process.execPath, [join(ROOT, "scripts", "import-recording.mjs"), rec, "sample", out], { stdio: "pipe" });
    const text = readFileSync(join(out, "sample", "fixture.json"), "utf8");
    // Anonymised: no machine paths left.
    expect(text).not.toContain(w.root);
    const fixture = JSON.parse(text) as Fixture;
    expect(fixture.tool).toBe(tool);
    expect(fixture.files).toEqual({ "src/a.ts": "export const a = 1;\n" });

    const { hook, run } = replay(fixture);
    expect(hook.stderr).not.toContain("didn't");
    expect(run.error?.code).toBeUndefined();
    expect(run.code).toBe(0);
  });
});
