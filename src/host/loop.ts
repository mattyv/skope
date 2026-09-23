// The host loop (SPEC §5.2): Step, emit the core's events with the fields
// only the host knows (EVENT_FIELDS in src/step.ts), answer the request
// with a handler, and repeat until Done. The deadline is checked between
// steps, never during a command (SPEC §7 step 5).

import { createHash } from "node:crypto";
import type { ExecResult } from "../runner/exec.js";
import type { Redactor } from "../runner/redact.js";
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
  /** The outcome event, emitted last by the caller (after any handoff events, SPEC §8). */
  outcomeEvent: Record<string, unknown>;
  effects: Effect[];
  /** The request and result the run ended on, for the handoff record's detail (SPEC §8.1). */
  lastAsk: Record<string, unknown> | null;
  lastExec: { cmd: string; exit: number | null; timed_out: boolean; stderr_tail: string } | null;
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
 * no links. HTML-style entities stop `<…>` links and `<!here>`, a
 * zero-width space after `@` stops mentions, and one inside `://` stops
 * URLs being linked.
 */
export function escapePage(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/@/g, "@\u200b").replace(/:\/\//g, ":/\u200b/");
}

export async function runLoop(interp: Interp, ctx: LoopContext): Promise<LoopResult> {
  const { handlers, redactor } = ctx;
  const effects: Effect[] = [];
  let lastAsk: LoopResult["lastAsk"] = null;
  let lastExec: LoopResult["lastExec"] = null;
  // Host fields for the core event that reports the request just answered.
  let pending: Record<string, unknown> = {};
  let unassigned = 0;
  let response: Response = { kind: "none" };

  for (;;) {
    const { events, next } = interp.step(response);
    for (const e of events) {
      const { at, ...body } = e;
      if (body.event === "outcome") {
        if (next.kind !== "done") throw new Error("the core reported an outcome but didn't finish");
        return { outcome: next.outcome, at, outcomeEvent: body, effects, lastAsk, lastExec, variables: interp.variables() };
      }
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
        // Probability the backend couldn't attribute is shown next to the options, so a tie it causes is visible.
        const probs = body.probs && unassigned > 0 ? { ...body.probs, unassigned } : body.probs;
        out.probs = probs;
        lastAsk = { question: body.question, probs, sure: body.sure, ...(body.range ? { range: body.range } : {}) };
      }
      ctx.emit(out);
    }
    if (next.kind === "done") throw new Error("the core finished without an outcome event");
    if (ctx.now() >= ctx.deadlineMs) {
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
        pending = {
          ms: Date.now() - started,
          truncated: r.truncated,
          stdout_hash: sha256(r.stdout),
          stdout_tail: redactor.redactedTail(r.stdout, TAIL_BYTES, r.truncated),
        };
        lastExec = { cmd: next.cmd, exit: r.exit, timed_out: r.timedOut, stderr_tail: stderrTail };
        // The core sees output only after redaction, so nothing downstream (context, record) can leak it.
        return {
          kind: "exec",
          exit: r.exit,
          stdout: redactor.redact(r.stdout, { truncated: r.truncated }),
          stderrTail,
          timedOut: r.timedOut,
        };
      }
      case "ask": {
        const { response: r, fields } = await handlers.ask(next.request, next.src);
        pending = { ...fields };
        unassigned = r.kind === "answer" ? r.unassigned : 0;
        return r;
      }
      case "page":
        return { kind: "page", ok: await handlers.page(escapePage(next.text)) };
      case "choose":
        throw new Error("the core asked to choose in a concrete run");
    }
  }
}
