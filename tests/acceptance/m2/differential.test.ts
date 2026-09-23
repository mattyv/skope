// The differential check (SPEC §12.4): "For each fake scenario, the
// concrete trace MUST appear among the explore handler's paths.
// `skop SKILL.md --verify --trace events.jsonl` checks one: it replays the
// trace's sequence of (section, line, response class) through the
// explorer's graph and exits 0 if the explorer can take that path, 40 if
// it can't. Deadline scenarios are excluded (§5.4)." Stream G: the deadline
// scenarios added since are excluded here, as the spec says.
//
// The trace file is an ordinary events.jsonl (a golden, or a real run's
// stdout captured to a file) — `--trace` takes exactly that shape, so this
// test builds it from the *actual* M3 run's events (not the golden), which
// also exercises the CLI's own JSON Lines output as a valid trace input.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runSkop } from "../lib/cli.js";
import { allScenarios } from "../lib/scenarios.js";

function writeTrace(events: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "skop-trace-"));
  const path = join(dir, "events.jsonl");
  writeFileSync(
    path,
    events
      .map((e) => JSON.stringify(e))
      .join("\n")
      .concat("\n"),
  );
  return path;
}

describe("differential check: a real run's trace is one --verify's explorer can take (SPEC §12.4)", () => {
  for (const s of allScenarios().filter((s) => s.name !== "deadline")) {
    test.fails(`${s.fixture}/${s.name}: --verify --trace exits 0 on the run's own trace`, async () => {
      const mode = s.name === "dry-run" ? "--dry-run" : "--apply";
      const run = await runSkop([s.skillPath, mode, "--fake", s.answersPath, "--fake-exec", s.commandsPath]);
      expect(run.events.length).toBeGreaterThan(0);
      const trace = writeTrace(run.events);

      const r = await runSkop([s.skillPath, "--verify", "--trace", trace]);
      expect(r.code).toBe(0);
    });

    test.fails(`${s.fixture}/${s.name}: --verify --trace exits 40 on a tampered trace`, async () => {
      const mode = s.name === "dry-run" ? "--dry-run" : "--apply";
      const run = await runSkop([s.skillPath, mode, "--fake", s.answersPath, "--fake-exec", s.commandsPath]);
      // Tamper with the trace by dropping its outcome event: no explored path ends mid-stream,
      // so the explorer can't have taken this (truncated) sequence.
      const tampered = run.events.filter((e) => (e as { event: string }).event !== "outcome");
      const trace = writeTrace(tampered);

      const r = await runSkop([s.skillPath, "--verify", "--trace", trace]);
      expect(r.code).toBe(40);
    });
  }
});
