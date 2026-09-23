// The host loop (SPEC §5.2) against a scripted core: which host fields it
// adds, what it sends back, the deadline, effects and page escaping.

import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { escapePage, type Handlers, runLoop } from "../../src/host/loop.js";
import type { ExecResult } from "../../src/runner/exec.js";
import { buildRedactor } from "../../src/runner/redact.js";
import type { CoreEvent, Next, Response } from "../../src/step.js";

const at = { section: "Triage", line: 3 };
const done: Next = { kind: "done", outcome: { kind: "stopped" } };
const outcome: CoreEvent = { at, event: "outcome", outcome: "stopped", reason: null, ask_calls: 0, effects: 0, dry_run: false };
const exec = (cmd: string, e: "run" | "do" | "check" = "run"): Next => ({ kind: "exec", cmd, exec: e, timeoutMs: 1000, src: 3 });

/** A core that plays back `script`, one step per entry, recording what it was sent. */
function scripted(script: { events: CoreEvent[]; next: Next }[]) {
  const got: Response[] = [];
  let i = 0;
  return {
    got,
    step(r: Response) {
      got.push(r);
      const s = script[i++];
      if (!s) throw new Error("stepped past the script");
      return s;
    },
    variables: () => ({ used: "91%" }),
  };
}

const result = (o: Partial<ExecResult> = {}): ExecResult => ({
  exit: 0,
  signal: null,
  stdout: "",
  stderr: "",
  timedOut: false,
  truncated: false,
  ...o,
});

function handlers(o: Partial<Handlers> = {}): Handlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    exec: async (n) => {
      calls.push(n.cmd);
      return result();
    },
    ask: async () => ({
      response: { kind: "answer", probs: { yes: 0.5, no: 0.25 }, unassigned: 0.25, backend: "fake", model: "fake", ms: 0 },
      fields: { backend: "fake", model: "fake", ms: 1, request_path: "/r/ask-1.json", request_sha256: "sha256:x" },
    }),
    page: async () => true,
    ...o,
  };
}

async function drive(core: ReturnType<typeof scripted>, h: Handlers, o: { now?: () => number; deadlineMs?: number } = {}) {
  const emitted: Record<string, unknown>[] = [];
  const r = await runLoop(core, {
    handlers: h,
    redactor: buildRedactor(),
    now: o.now ?? (() => 0),
    deadlineMs: o.deadlineMs ?? 1000,
    emit: (e) => emitted.push(e),
  });
  return { r, emitted };
}

describe("host loop", () => {
  test("a run event gets its host fields; the core and the log see only redacted output", async () => {
    const raw = "ok password=hunter2\n";
    const core = scripted([
      { events: [], next: exec("df") },
      { events: [{ at, event: "run", cmd: "df", exit: 0, timed_out: false, after_would_do: false }, outcome], next: done },
    ]);
    const h = handlers({ exec: async () => result({ stdout: raw, stderr: "token: abc\n" }) });
    const { r, emitted } = await drive(core, h);
    expect(emitted[0]).toMatchObject({
      event: "run",
      section: "Triage",
      line: 3,
      truncated: false,
      stdout_hash: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
      stdout_tail: "ok [REDACTED]\n",
    });
    expect(emitted[0]?.ms).toBeTypeOf("number");
    expect(core.got[1]).toEqual({ kind: "exec", exit: 0, stdout: "ok [REDACTED]\n", stderrTail: "[REDACTED]\n", timedOut: false });
    expect(r.lastExec).toEqual({ cmd: "df", exit: 0, timed_out: false, stderr_tail: "[REDACTED]\n" });
    // The loop hands the outcome back instead of emitting it: handoff events come first (SPEC §8).
    expect(emitted.some((e) => e.event === "outcome")).toBe(false);
    expect(r.at).toEqual(at);
    expect(r.variables).toEqual({ used: "91%" });
  });

  test("effect_end gets ms but none of a run's fields (the event contract is closed)", async () => {
    const core = scripted([
      { events: [{ at, event: "effect_start", cmd: "rm x" }], next: exec("rm x", "do") },
      { events: [{ at, event: "effect_end", cmd: "rm x", exit: 0, timed_out: false }, outcome], next: done },
    ]);
    const { emitted } = await drive(core, handlers());
    expect(Object.keys(emitted[1] ?? {}).sort()).toEqual(["cmd", "event", "exit", "line", "ms", "section", "timed_out"]);
  });

  test("past the deadline, the next request isn't performed: the core gets a deadline response", async () => {
    const core = scripted([
      { events: [], next: exec("df") },
      { events: [outcome], next: { kind: "done", outcome: { kind: "handoff", reason: "deadline", detail: null } } },
    ]);
    const h = handlers();
    await drive(core, h, { now: () => 1000, deadlineMs: 1000 });
    expect(h.calls).toEqual([]);
    expect(core.got[1]).toEqual({ kind: "deadline" });
  });

  test("before the deadline, the request is performed", async () => {
    const core = scripted([
      { events: [], next: exec("df") },
      { events: [outcome], next: done },
    ]);
    const h = handlers();
    await drive(core, h, { now: () => 999, deadlineMs: 1000 });
    expect(h.calls).toEqual(["df"]);
  });

  test("effects: done, failed, unknown on a timeout or no end, would_do in a dry run (SPEC §8.1)", async () => {
    const ev = (cmd: string, exit: number | null, timed_out = false): CoreEvent => ({ at, event: "effect_end", cmd, exit, timed_out });
    const core = scripted([
      {
        events: [
          { at, event: "effect_start", cmd: "a" },
          ev("a", 0),
          { at, event: "effect_start", cmd: "b" },
          ev("b", 1),
          { at, event: "effect_start", cmd: "c" },
          ev("c", null, true),
          { at, event: "would_do", cmd: "d" },
          { at, event: "effect_start", cmd: "e" },
          outcome,
        ],
        next: done,
      },
    ]);
    const { r } = await drive(core, handlers());
    expect(r.effects).toEqual([
      { cmd: "a", status: "done" },
      { cmd: "b", status: "failed" },
      { cmd: "c", status: "unknown" },
      { cmd: "d", status: "would_do" },
      { cmd: "e", status: "unknown" },
    ]);
  });

  test("an ask event gets the backend's fields, and unassigned probability is shown with the options", async () => {
    const ask: CoreEvent = {
      at,
      event: "ask",
      question: "q?",
      kind: "yesno",
      probs: { yes: 0.5, no: 0.25 },
      chosen: "yes",
      confidence: 0.5,
      sure: 90,
      passed: false,
      after_would_do: false,
    };
    const request = { kind: "yesno", question: "q?", guidance: null, options: [], context: {}, timeout_ms: 1 } as never;
    const core = scripted([
      { events: [], next: { kind: "ask", request, src: 3 } },
      { events: [ask, outcome], next: done },
    ]);
    const { r, emitted } = await drive(core, handlers());
    expect(emitted[0]).toMatchObject({
      backend: "fake",
      model: "fake",
      request_path: "/r/ask-1.json",
      probs: { yes: 0.5, no: 0.25, unassigned: 0.25 },
    });
    expect(r.lastAsk).toEqual({ question: "q?", probs: { yes: 0.5, no: 0.25, unassigned: 0.25 }, sure: 90 });
  });

  test("page text is escaped in the event and to the pager: no mentions, no links", async () => {
    const sent: string[] = [];
    const core = scripted([
      { events: [], next: { kind: "page", text: "@here see <http://x.io|x>", src: 3 } },
      { events: [{ at, event: "page", text: "@here see <http://x.io|x>", ok: true }, outcome], next: done },
    ]);
    const { emitted } = await drive(
      core,
      handlers({
        page: async (t) => {
          sent.push(t);
          return true;
        },
      }),
    );
    expect(sent[0]).toBe(escapePage("@here see <http://x.io|x>"));
    expect(emitted[0]?.text).toBe(sent[0]);
    expect(sent[0]).not.toMatch(/@here|<|>|:\/\//);
  });

  test("a choose request in a concrete run is a bug", async () => {
    const core = scripted([{ events: [], next: { kind: "choose", n: 3 } }]);
    await expect(drive(core, handlers())).rejects.toThrow(/choose/);
  });

  test("an outcome without done, or done without an outcome, is a bug", async () => {
    await expect(drive(scripted([{ events: [outcome], next: exec("x") }]), handlers())).rejects.toThrow(/outcome/);
    await expect(drive(scripted([{ events: [], next: done }]), handlers())).rejects.toThrow(/outcome/);
  });
});
