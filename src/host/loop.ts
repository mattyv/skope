// The host loop (SPEC §5.2): Step, emit the core's events with the fields
// only the host knows (EVENT_FIELDS in src/step.ts), answer the request
// with a handler, and repeat until Done. The deadline is checked between
// steps, never during a command (SPEC §7 step 5).

import { createHash } from "node:crypto";
import type { ExecResult } from "../runner/exec.js";
import { type Redactor, tailBytes } from "../runner/redact.js";
import { type AskRequest, type CoreEvent, EVENT_FIELDS, type Next, type Outcome, type Response, type Val, type Where } from "../step.js";

export interface Interp {
  step(r: Response): { events: CoreEvent[]; next: Next };
  variables(): Record<string, Val>;
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
  ask(request: AskRequest, src: number): Promise<{ response: Response; fields: AskFields }>;
  /** Sends an already-escaped page; true if the pager succeeded. */
  page(text: string): Promise<boolean>;
}

export interface Effect {
  cmd: string;
  status: "done" | "failed" | "would_do" | "unknown";
}

export interface LoopResult {
  outcome: Outcome;
  /** Where the run ended: for a deadline, the instruction it would have started next. */
  at: Where | null;
  effects: Effect[];
  /** The request and result the run ended on, for the handoff record's detail (SPEC §8.1). */
  lastAsk: Record<string, unknown> | null;
  lastExec: { cmd: string; exit: number | null; timed_out: boolean; stderr_tail: string } | null;
  /** When the run ended on a comparison that couldn't coerce its operands, that comparison (SPEC §4.2). */
  failedCheck: { expr: string; left: string | null; right: string | null } | null;
  variables: Record<string, Val>;
}

export interface LoopContext {
  handlers: Handlers;
  redactor: Redactor;
  /** Milliseconds since the run started, including any simulated time (--fake-exec `ms`). */
  now(): number;
  deadlineMs: number;
  emit(e: Record<string, unknown>): void;
}

const sha256 = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const TAIL_BYTES = 2048;

/**
 * Page text is escaped for the pager (SPEC §3.5, §11 rule 8): no mentions,
 * no links. HTML-style entities stop `<…>` links and `<!here>`; a
 * zero-width space after `@` stops mentions, and one inside `://` or after
 * a dot inside a word stops URLs and bare domains (`evil.example`) being
 * linked; `[` and `]` are backslash-escaped so `[x](…)` isn't a link.
 */
export function escapePage(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[[\]]/g, "\\$&")
    .replace(/@/g, "@\u200b")
    .replace(/:\/\//g, ":/\u200b/")
    .replace(/\.(?=[\p{L}\p{N}])/gu, ".\u200b");
}

export async function runLoop(interp: Interp, ctx: LoopContext): Promise<LoopResult> {
  const { handlers, redactor } = ctx;
  const effects: Effect[] = [];
  let lastAsk: LoopResult["lastAsk"] = null;
  let lastExec: LoopResult["lastExec"] = null;
  let failedCheck: LoopResult["failedCheck"] = null;
  // Host fields for the core event that reports the request just answered.
  let pending: Record<string, unknown> = {};
  let response: Response = { kind: "none" };

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
        return { outcome: next.outcome, at, effects, lastAsk, lastExec, failedCheck, variables: interp.variables() };
      }
      // Only a failed comparison right before the outcome is what the run ended on.
      failedCheck = body.event === "check" && body.result === null ? { expr: body.expr, left: body.left, right: body.right } : null;
      const out: Record<string, unknown> = { ...(at ?? {}), ...body };
      const hostFields = EVENT_FIELDS[body.event]?.host ?? [];
      for (const k of hostFields) if (k in pending) out[k] = pending[k];
      if (hostFields.length > 0) pending = {};
      if (body.event === "page" || body.event === "would_page") out.text = escapePage(body.text);
      if (body.event === "effect_start") effects.push({ cmd: body.cmd, status: "unknown" });
      if (body.event === "effect_end") {
        const last = effects.findLast((x) => x.cmd === body.cmd && x.status === "unknown");
        if (last && !body.timed_out) last.status = body.exit === 0 ? "done" : "failed";
      }
      if (body.event === "would_do") effects.push({ cmd: body.cmd, status: "would_do" });
      if (body.event === "ask") {
        lastAsk = { question: body.question, probs: body.probs, sure: body.sure, ...(body.range ? { range: body.range } : {}) };
      }
      ctx.emit(out);
    }
    if (next.kind === "done") throw new Error("the core finished without an outcome event");
    if (late) {
      response = { kind: "deadline" };
      continue;
    }
    response = await answer(next);
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
        lastExec = { cmd: next.cmd, exit: r.exit, timed_out: r.timedOut, stderr_tail: stderrTail };
        return { kind: "exec", exit: r.exit, stdout, stderrTail, timedOut: r.timedOut };
      }
      case "ask": {
        const { response: r, fields } = await handlers.ask(next.request, next.src);
        pending = { ...fields };
        return r;
      }
      case "page":
        return { kind: "page", ok: await handlers.page(escapePage(next.text)) };
      case "choose":
        throw new Error("the core asked to choose in a concrete run");
    }
  }
}
