// A command's output can be up to 1 MiB (SPEC §4.4). Push that much through
// the whole run: bound by `run … as`, sent as ask context, interpolated into
// a page, and kept in the handoff record. Dafny's runtime once spread every
// character into a function call and overflowed the stack past ~30k.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runSkop } from "../acceptance/lib/cli.js";

const SKILL = `---
name: big-output
description: A run whose command prints a lot.
format: 1
---

## Triage
Look at the log.

- **run** \`journalctl -n 100000\` as log
- **ask** Given {log}, what now? · sure 90%
  - [Page]
  - [Fix]

## Page
Tell a human.

- **page** "saw {log}"

## Fix
Nothing to do.

- **stop**
`;

// 1 MiB of log lines, the capture cap.
const LOG = "Sep 24 03:12:44 host kernel: EXT4-fs error on device sda1\n".repeat(Math.ceil((1 << 20) / 58)).slice(0, 1 << 20);

function scenario(answer: unknown): string[] {
  const dir = mkdtempSync(join(tmpdir(), "skop-big-"));
  writeFileSync(join(dir, "SKILL.md"), SKILL);
  // JSON is YAML; the fake files accept either.
  writeFileSync(join(dir, "commands.json"), JSON.stringify({ "journalctl -n 100000": { exit: 0, stdout: LOG } }));
  writeFileSync(join(dir, "answers.json"), JSON.stringify({ "line:11": answer }));
  return [join(dir, "SKILL.md"), "--apply", "--fake", join(dir, "answers.json"), "--fake-exec", join(dir, "commands.json")];
}

describe("1 MiB of command output runs end to end (SPEC §4.4)", () => {
  test("bound, sent as context, and paged: exit 10, no E-INTERNAL", async () => {
    const r = await runSkop(scenario({ "s:page": 1, "s:fix": 0 }));
    expect(r.stderr).not.toMatch(/E-INTERNAL/);
    expect(r.code).toBe(10);
    const page = r.events.find((e) => e.event === "page") as { text: string } | undefined;
    expect(page?.text.length).toBeGreaterThan(1 << 19);
  }, 60_000);

  test("kept in the handoff record when the backend is unavailable: exit 20, no E-INTERNAL", async () => {
    const r = await runSkop(scenario("unavailable"));
    expect(r.stderr).not.toMatch(/E-INTERNAL/);
    expect(r.code).toBe(20);
    const rec = r.events.find((e) => e.event === "handoff_record") as { record: { variables: { log: string } } } | undefined;
    expect(rec?.record.variables.log.length).toBeGreaterThan(1 << 19);
  }, 60_000);
});
