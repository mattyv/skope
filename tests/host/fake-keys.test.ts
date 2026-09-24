// Stable fake keys through the CLI (SPEC §5.4): a scenario keyed by
// `Section.var` / `Section.ask` runs exactly as the same scenario keyed by
// `line:N`, and bad keys are reported before anything runs.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runSkope, type SkopeEvent } from "../acceptance/lib/cli.js";
import { ROOT } from "../acceptance/lib/scenarios.js";

const SKILL = `${ROOT}/fixtures/disk-full/SKILL.md`;
const FAKES = `${ROOT}/fixtures/disk-full/fakes/restart-happy`;

function file(name: string, doc: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "skope-keys-")), name);
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

/** The events without what differs between any two runs: times, paths and the run id. */
const shape = (events: SkopeEvent[]) =>
  JSON.parse(
    JSON.stringify(events.map(({ ts, run_id, run_dir, request_path, path, record, ms, ...rest }) => rest)).replace(/r-[0-9a-f]{8}/g, "r-x"),
  );

describe("stable fake keys (SPEC §5.4)", () => {
  test("restart-happy keyed by Section.var and Section.ask runs the same as keyed by line:N", async () => {
    const byLine = await runSkope([SKILL, "--apply", "--fake", `${FAKES}/answers.yaml`, "--fake-exec", `${FAKES}/commands.yaml`]);
    const commands = file("commands.yaml", {
      "Triage.used": { exit: 0, stdout: " 93%\n" },
      "Triage.errors": { exit: 0, stdout: "myapp-worker OOM\n" },
      "Triage.biggest": { exit: 0, stdout: "40G\t/var\n" },
      "line:47": { exit: 0 }, // a do binds nothing, so it keeps its line
      "Restart.used": { exit: 0, stdout: " 91%\n" },
    });
    const answers = file("answers.yaml", {
      "Triage.ask": { "s:clean_up": 0.03125, "s:restart": 0.875, "s:page": 0.0625, "s:investigate": 0.03125 },
      "Restart.service": { nginx: 0.03125, rsyslog: 0.03125, "myapp-worker": 0.90625, "myapp-api": 0.03125 },
    });
    const byName = await runSkope([SKILL, "--apply", "--fake", answers, "--fake-exec", commands]);
    expect(byName.code).toBe(byLine.code);
    expect(shape(byName.events)).toEqual(shape(byLine.events));
  });

  test("W-FAKE-UNUSED: a key that names no statement is warned about, and the run goes on", async () => {
    const commands = file("commands.yaml", {
      "Triage.used": { exit: 0, stdout: " 10%\n" },
      "Triage.nope": { exit: 0 },
    });
    const r = await runSkope([SKILL, "--apply", "--fake", file("answers.yaml", {}), "--fake-exec", commands]);
    expect(r.code).toBe(0);
    expect(r.events.find((e) => e.event === "warning")).toMatchObject({ code: "W-FAKE-UNUSED", stage: "args" });
  });

  test("E-FAKE-AMBIGUOUS: a key that names two statements stops before the run, exit 40", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skope-keys-"));
    const skill = join(dir, "SKILL.md");
    writeFileSync(
      skill,
      "---\nname: tiny\ndescription: t\nformat: 1\n---\n\n## Main\nDo it.\n\n- **run** `echo 1` as n\n- **run** `echo 2` as n\n- **stop**\n",
    );
    const r = await runSkope([skill, "--apply", "--fake-exec", file("commands.yaml", { "Main.n": { exit: 0 } })]);
    expect(r.code).toBe(40);
    expect(r.events.find((e) => e.event === "error")).toMatchObject({ code: "E-FAKE-AMBIGUOUS", stage: "args" });
    expect(r.events.find((e) => e.event === "run_start")).toBeUndefined();
  });
});
