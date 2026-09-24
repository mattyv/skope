// Error and event output (SPEC §7.1, §10): stdout JSON Lines validated
// against contracts/event.schema.json, stderr readable line format.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import {
  diagnosticEvent,
  diagnosticLine,
  type EventContext,
  lockedEvent,
  report,
  staleLockEvent,
  stdoutSink,
} from "../../src/runner/events.js";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;
const read = (p: string) => JSON.parse(readFileSync(new URL(`../../contracts/${p}`, import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validate = ajv.compile(read("event.schema.json"));

const ctx: EventContext = { run_id: "r-1", skill: "disk-full", skill_hash: `sha256:${"a".repeat(64)}`, host: "hk-app-03" };
const ctxNoRun: EventContext = { run_id: null, skill: null, skill_hash: null, host: "hk-app-03" };

describe("error and warning events (SPEC §7.1, §10)", () => {
  test("diagnosticEvent error with file and line validates against event.schema.json", () => {
    const ev = diagnosticEvent("error", ctx, { code: "E-TAINT", stage: "lint", file: "disk-full/SKILL.md", line: 14, message: "boom" });
    expect(validate(ev), JSON.stringify(validate.errors)).toBe(true);
    expect(ev).toEqual({
      ts: expect.any(String),
      run_id: "r-1",
      skill: "disk-full",
      skill_hash: `sha256:${"a".repeat(64)}`,
      host: "hk-app-03",
      event: "error",
      code: "E-TAINT",
      stage: "lint",
      file: "disk-full/SKILL.md",
      line: 14,
      message: "boom",
    });
  });

  test("diagnosticEvent error with no source line (E-MODE) validates and omits file/line", () => {
    const ev = diagnosticEvent("error", ctxNoRun, { code: "E-MODE", stage: "args", message: "neither --apply nor --dry-run" });
    expect(validate(ev), JSON.stringify(validate.errors)).toBe(true);
    expect("file" in ev).toBe(false);
    expect("line" in ev).toBe(false);
  });

  test("diagnosticEvent warning validates against event.schema.json", () => {
    const ev = diagnosticEvent("warning", ctx, { code: "W-REDACT-OFF", stage: "runtime", message: "built-in redaction is off" });
    expect(validate(ev), JSON.stringify(validate.errors)).toBe(true);
    expect(ev.event).toBe("warning");
  });

  test("lockedEvent and staleLockEvent validate against event.schema.json", () => {
    const locked = lockedEvent(ctxNoRun, 4242);
    expect(validate(locked), JSON.stringify(validate.errors)).toBe(true);
    expect(locked).toMatchObject({ event: "locked", holder_pid: 4242 });

    const stale = staleLockEvent(ctxNoRun, "/run/skope/disk-full.lock", 4242);
    expect(validate(stale), JSON.stringify(validate.errors)).toBe(true);
    expect(stale).toMatchObject({ event: "stale_lock", path: "/run/skope/disk-full.lock", holder_pid: 4242 });
  });

  test("staleLockEvent with an unreadable lock has holder_pid null and validates", () => {
    const stale = staleLockEvent(ctxNoRun, "/run/skope/disk-full.lock", null);
    expect(validate(stale), JSON.stringify(validate.errors)).toBe(true);
    expect(stale.holder_pid).toBeNull();
  });

  test("diagnosticLine matches the spec's stderr format (SPEC §7.1)", () => {
    const line = diagnosticLine({
      code: "E-TAINT",
      file: "disk-full/SKILL.md",
      line: 14,
      message: "{errors} comes from a run command and can't go in a command",
    });
    expect(line).toBe("disk-full/SKILL.md:14: E-TAINT: {errors} comes from a run command and can't go in a command");
  });

  test("diagnosticLine omits file:line when there's no source line", () => {
    const line = diagnosticLine({ code: "E-MODE", message: "neither --apply nor --dry-run" });
    expect(line).toBe("E-MODE: neither --apply nor --dry-run");
  });

  test("a message with newlines or control characters stays one line on stderr", () => {
    const line = diagnosticLine({ code: "E-CONFIG", file: "a\nb.yaml", line: 2, message: "bad value:\nnext line\r\u001b[31m" });
    expect(line).toBe("a\\nb.yaml:2: E-CONFIG: bad value:\\nnext line\\r\\u001b[31m");
  });

  test("report error writes one JSON event to the sink and one readable line to stderr", () => {
    const emitted: object[] = [];
    const sink = { emit: (e: object) => emitted.push(e) };
    const stderrLines: string[] = [];
    report(sink, (s) => stderrLines.push(s), "error", ctx, { code: "E-TAINT", stage: "lint", file: "s.md", line: 1, message: "m" });
    expect(emitted).toHaveLength(1);
    expect(validate(emitted[0]), JSON.stringify(validate.errors)).toBe(true);
    expect(stderrLines).toEqual(["s.md:1: E-TAINT: m\n"]);
  });

  test("report warning writes one JSON event to the sink and one readable line to stderr", () => {
    const emitted: object[] = [];
    const sink = { emit: (e: object) => emitted.push(e) };
    const stderrLines: string[] = [];
    report(sink, (s) => stderrLines.push(s), "warning", ctx, { code: "W-REDACT-OFF", stage: "runtime", message: "off" });
    expect(emitted).toHaveLength(1);
    expect(validate(emitted[0]), JSON.stringify(validate.errors)).toBe(true);
    expect(stderrLines).toEqual(["W-REDACT-OFF: off\n"]);
  });

  test("stdoutSink writes one JSON line per event, newline-terminated", () => {
    const written: string[] = [];
    const sink = stdoutSink((s) => written.push(s));
    sink.emit({ a: 1 });
    sink.emit({ b: 2 });
    expect(written).toEqual(['{"a":1}\n', '{"b":2}\n']);
  });
});
