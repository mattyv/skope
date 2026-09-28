// The host loop (SPEC §5.2): Step, emit the core's events with the fields
// only the host knows (EVENT_FIELDS in src/step.ts), answer the request
// with a handler, and repeat until Done. The deadline is checked between
// steps, never during a command (SPEC §7 step 5).

import { createHash } from "node:crypto";
import { plainText } from "../runner/events.js";
import type { ExecResult } from "../runner/exec.js";
import { type Redactor, tailBytes } from "../runner/redact.js";
import { type AskRequest, type CoreEvent, EVENT_FIELDS, type Next, type Outcome, type Response, type Val, type Where } from "../step.js";

export interface Interp {
  step(r: Response): { events: CoreEvent[]; next: Next };
  variables(): Record<string, Val>;
  /** A sweep's question for one output line, while its command is pending (SPEC §4.8). */
  sweepAsk?(item: string): { request: AskRequest; sure: number; section: string } | null;
  /** The proven gate on a yes/no answer; null if the answer is invalid. */
  gateYesNo?(
    probs: Record<string, number>,
    unassigned: number,
    sure: number,
  ): { chosen: string; confidence: number; passed: boolean } | null;
}

export type ExecNext = Extract<Next, { kind: "exec" }>;

export interface AskFields {
  backend: string;
  model: string;
  ms: number;
  request_path: string;
  request_sha256: string;
}

export interface Handlers {
  exec(next: ExecNext): Promise<ExecResult>;
  /** `item` is a sweep item's index (SPEC §4.8), for fakes that answer per item. */
  ask(request: AskRequest, src: number, item?: number): Promise<{ response: Response; fields: AskFields }>;
  /** Saves a sweep's report in the run directory and returns its path. */
  sweepReport?(report: SweepReport): string;
  /** Sends an already-escaped page; true if the pager succeeded. */
  page(text: string): Promise<boolean>;
}

export interface Effect {
  cmd: string;
  status: "done" | "failed" | "would_do" | "unknown";
}

/** One `ask each` (SPEC §4.8): what Jev said about each line. Nothing acts on it. */
export interface SweepReport {
  section: string | null;
  line: number;
  cmd: string;
  question: string;
  sure: number;
  items: { item: string; answer: "yes" | "no" | "unsure"; confidence: number | null }[];
  yes: number;
  no: number;
  unsure: number;
  /** Lines never asked about: past the cap, after the deadline, or after the backend failed. */
  skipped: number;
  /** Why the sweep stopped early, if it did. */
  stopped: "deadline" | "ask_unavailable" | null;
}

export const SWEEP_MAX_ITEMS = 200;

export interface LoopResult {
  outcome: Outcome;
  /** Where the run ended: for a deadline, the instruction it would have started next. */
  at: Where | null;
  effects: Effect[];
  /** The request and result the run ended on, for the handoff record's detail (SPEC §8.1). */
  lastAsk: Record<string, unknown> | null;
  lastExec: { cmd: string; exit: number | null; timed_out: boolean; stderr_tail: string; stdout_tail?: string } | null;
  variables: Record<string, Val>;
  /** Summaries of the sweeps that ran, for the handoff record. */
  sweeps: Record<string, unknown>[];
}

export interface LoopContext {
  handlers: Handlers;
  redactor: Redactor;
  /** Milliseconds since the run started, including any simulated time (--fake-exec `ms`). */
  now(): number;
  deadlineMs: number;
  emit(e: Record<string, unknown>): void;
  /** How much of a failed command's output the handoff detail keeps (default 2 KB; plans keep more). */
  detailBytes?: number;
}

const sha256 = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const TAIL_BYTES = 2048;

/**
 * Page text from the skill is escaped for the pager (SPEC §3.5, §11 rule
 * 8): no mentions, no links. The core's text mixes author words with
 * values, so everything link-like is broken, and nothing else: HTML-style
 * entities stop `<…>` links and `<!here>`; a zero-width space after `@`
 * stops mentions, and one inside `://` or after a dot between a word and a
 * letter stops URLs, `www.` and bare domains (`evil.example`); a markdown
 * link `[x](…)` gets its brackets backslash-escaped. skope's own parts of a
 * page (host, run dir, record path) are never passed through this.
 * Control characters are removed first (plainText).
 */
export function escapePage(text: string): string {
  return plainText(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[([^[\]\n]*)\]\(/g, "\\[$1\\](")
    .replace(/@/g, "@\u200b")
    .replace(/:\/\//g, ":/\u200b/")
    .replace(/(?<=[\p{L}\p{N}])\.(?=\p{L})/gu, ".\u200b");
}

export async function runLoop(interp: Interp, ctx: LoopContext): Promise<LoopResult> {
  const { handlers, redactor } = ctx;
  const effects: Effect[] = [];
  let lastAsk: LoopResult["lastAsk"] = null;
  let lastExec: LoopResult["lastExec"] = null;
  // Host fields for the core event that reports the request just answered.
  let pending: Record<string, unknown> = {};
  let response: Response = { kind: "none" };
  // A sweep's events wait for the core's `run` event, which reports its command first.
  const afterRun: Record<string, unknown>[] = [];
  const sweeps: Record<string, unknown>[] = [];

  for (;;) {
    const step = interp.step(response);
    const next = step.next;
    // Checked before this step's events go out: the core reports a do's effect_start in the
    // step that requests it, and past the deadline that do never starts (SPEC §5.4, §7 step 5).
    const late = next.kind !== "done" && ctx.now() >= ctx.deadlineMs;
    const last = step.events.at(-1);
    const unstarted = late && next.kind === "exec" && next.exec === "do" && last?.event === "effect_start" && last.cmd === next.cmd;
    const events = unstarted ? step.events.slice(0, -1) : step.events;
    for (const e of events) {
      const { at, ...body } = e;
      if (body.event === "outcome") {
        if (next.kind !== "done") throw new Error("the core reported an outcome but didn't finish");
        // The caller emits the outcome last, after any handoff events (SPEC §8).
        for (const x of afterRun.splice(0)) ctx.emit(x);
        return { outcome: next.outcome, at, effects, lastAsk, lastExec, variables: interp.variables(), sweeps };
      }
      const out: Record<string, unknown> = { ...(at ?? {}), ...body };
      const hostFields = EVENT_FIELDS[body.event]?.host ?? [];
      for (const k of hostFields) if (k in pending) out[k] = pending[k];
      if (hostFields.length > 0) pending = {};
      // Redacted before escaping, which breaks up the text a pattern would match.
      if (body.event === "page" || body.event === "would_page") out.text = escapePage(redactor.redact(body.text));
      if (body.event === "effect_start") effects.push({ cmd: body.cmd, status: "unknown" });
      if (body.event === "effect_end") {
        const last = effects.findLast((x) => x.cmd === body.cmd && x.status === "unknown");
        if (last && !body.timed_out) last.status = body.exit === 0 ? "done" : "failed";
      }
      if (body.event === "would_do") effects.push({ cmd: body.cmd, status: "would_do" });
      if (body.event === "ask") {
        lastAsk = { question: body.question, probs: body.probs, sure: body.sure };
      }
      ctx.emit(out);
      if (body.event === "run") for (const x of afterRun.splice(0)) ctx.emit(x);
    }
    if (next.kind === "done") throw new Error("the core finished without an outcome event");
    if (late) {
      response = { kind: "deadline" };
      continue;
    }
    response = await answer(next);
  }

  /** SPEC §4.8: one yes/no ask per non-empty output line, gated by the core; the report acts on nothing. */
  async function sweep(next: ExecNext, stdout: string, truncated: boolean) {
    let lines = stdout.split("\n").filter((l) => l.trim() !== "");
    // The last line of cut-off output may be cut off too.
    if (truncated && !stdout.endsWith("\n")) lines = lines.slice(0, -1);
    // The item is named in backticks, so the rendered question is the same for every line.
    const probe = interp.sweepAsk?.("");
    if (!probe) return;
    const { sure, section } = probe;
    const at = { section, line: next.src };
    const report: SweepReport = {
      section,
      line: next.src,
      cmd: next.cmd,
      question: probe.request.question,
      sure,
      items: [],
      yes: 0,
      no: 0,
      unsure: 0,
      skipped: Math.max(0, lines.length - SWEEP_MAX_ITEMS),
      stopped: null,
    };
    const todo = lines.slice(0, SWEEP_MAX_ITEMS);
    for (const [i, item] of todo.entries()) {
      if (ctx.now() >= ctx.deadlineMs) {
        report.stopped = "deadline";
        report.skipped += todo.length - i;
        break;
      }
      const q = interp.sweepAsk?.(item);
      if (!q) throw new Error("a sweep's question went away mid-sweep");
      const { response: a, fields } = await handlers.ask(q.request, next.src, i);
      const verdict = a.kind === "answer" ? (interp.gateYesNo?.(a.probs, a.unassigned, sure) ?? null) : null;
      const base = { ...at, event: "sweep_item", index: i, item, question: q.request.question, sure, ...fields };
      if (a.kind !== "answer" || verdict === null) {
        // A failed call, or an answer the gate calls invalid, counts as the backend being unavailable (SPEC §6.1).
        afterRun.push({ ...base, probs: a.kind === "answer" ? a.probs : null, answer: null, confidence: null, detail: "unavailable" });
        report.stopped = "ask_unavailable";
        report.skipped += todo.length - i;
        break;
      }
      const answer = verdict.passed ? (verdict.chosen as "yes" | "no") : "unsure";
      report[answer]++;
      report.items.push({ item, answer, confidence: verdict.confidence });
      afterRun.push({ ...base, probs: a.probs, answer, confidence: verdict.confidence });
    }
    const path = handlers.sweepReport ? handlers.sweepReport(report) : null;
    const summary = {
      ...at,
      cmd: next.cmd,
      question: report.question,
      yes: report.yes,
      no: report.no,
      unsure: report.unsure,
      skipped: report.skipped,
      stopped: report.stopped,
      path,
    };
    sweeps.push(summary);
    afterRun.push({ ...at, event: "sweep", ...summary });
  }

  async function answer(next: Exclude<Next, { kind: "done" }>): Promise<Response> {
    switch (next.kind) {
      case "exec": {
        const started = Date.now();
        const r = await handlers.exec(next);
        const stderrTail = redactor.redactedTail(r.stderr, TAIL_BYTES, r.truncated);
        // The core, the hash and the tail all see only redacted output, so no log or record leaks a
        // secret, and a hash can't be used to test guesses of one (SPEC §10).
        const stdout = redactor.redact(r.stdout, { truncated: r.truncated });
        pending = {
          ms: Date.now() - started,
          truncated: r.truncated,
          stdout_hash: sha256(stdout),
          stdout_tail: tailBytes(stdout, TAIL_BYTES),
        };
        const detailBytes = ctx.detailBytes ?? TAIL_BYTES;
        lastExec =
          detailBytes > TAIL_BYTES
            ? {
                cmd: next.cmd,
                exit: r.exit,
                timed_out: r.timedOut,
                stderr_tail: redactor.redactedTail(r.stderr, detailBytes, r.truncated),
                stdout_tail: tailBytes(stdout, detailBytes),
              }
            : { cmd: next.cmd, exit: r.exit, timed_out: r.timedOut, stderr_tail: stderrTail };
        // A sweep asks about each line only when its command succeeded; otherwise the core fails it as a run.
        if (next.exec === "run" && r.exit === 0 && !r.timedOut) await sweep(next, stdout, r.truncated);
        return { kind: "exec", exit: r.exit, stdout, stderrTail, timedOut: r.timedOut };
      }
      case "ask": {
        const { response: r, fields } = await handlers.ask(next.request, next.src);
        pending = { ...fields };
        return r;
      }
      case "page":
        return { kind: "page", ok: await handlers.page(escapePage(redactor.redact(next.text))) };
      case "choose":
        throw new Error("the core asked to choose in a concrete run");
    }
  }
}
