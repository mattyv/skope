// The core/host interface (SPEC §5.2) as the host sees it: a mirror of
// core/Step.dfy. The adapter (src/core.ts) converts between these and the
// compiled Dafny values. tests/step.test.ts keeps the constructor names in
// step with the Dafny file and the event contract.

// The request is the ask contract's, so it's generated, not repeated here.
import type { AskRequest } from "./contracts.gen.js";

export type { AskRequest };

export const REASONS = ["explicit", "gate_failed", "command_failed", "ask_unavailable", "deadline"] as const;
export type Reason = (typeof REASONS)[number];

export type Outcome = { kind: "stopped" } | { kind: "paged" } | { kind: "handoff"; reason: Reason; detail: string | null };

export type ExecKind = "run" | "do" | "check";

export type Next =
  | { kind: "exec"; cmd: string; exec: ExecKind; timeoutMs: number; src: number }
  | { kind: "ask"; request: AskRequest; src: number }
  | { kind: "page"; text: string; src: number }
  | { kind: "choose"; n: number } // explore mode only (SPEC §5.4)
  | { kind: "done"; outcome: Outcome };

export type Response =
  | { kind: "none" }
  // exit is null when the command timed out or was killed.
  | { kind: "exec"; exit: number | null; stdout: string; stderrTail: string; timedOut: boolean }
  | { kind: "answer"; probs: Record<string, number>; unassigned: number; backend: string; model: string; ms: number }
  | { kind: "ask_failed"; error: "unavailable" | "request_too_large"; backend: string }
  | { kind: "page"; ok: boolean }
  | { kind: "picked"; i: number }
  | { kind: "deadline" }; // the host may send this instead of any response

export type Val = string | number;

/** Where an event happened: the section's display name and the SKILL.md line. */
export interface Where {
  section: string;
  line: number;
}

/** What Step reports (CoreEvent in core/Step.dfy). The host turns each into a SPEC §10 event, adding EVENT_FIELDS[event].host. */
export type CoreEvent = { at: Where | null } & (
  | { event: "run" | "check_cmd"; cmd: string; exit: number | null; timed_out: boolean; after_would_do: boolean }
  | { event: "check"; expr: string; left: string | null; right: string | null; result: boolean | null; after_would_do: boolean }
  | {
      event: "ask";
      question: string;
      kind: "choice" | "yesno" | "score";
      probs: Record<string, number> | null;
      chosen: string | number | null;
      confidence: number | null;
      sure: number;
      passed: boolean;
      range?: [number, number];
      detail?: "unavailable" | "request_too_large";
      after_would_do: boolean;
    }
  | { event: "effect_start"; cmd: string }
  | { event: "effect_end"; cmd: string; exit: number | null; timed_out: boolean }
  | { event: "would_do"; cmd: string }
  | { event: "page"; text: string; ok: boolean }
  | { event: "would_page"; text: string }
  | { event: "transfer"; from: string; to: string }
  | {
      event: "outcome";
      outcome: "stopped" | "paged" | "handoff";
      reason: Reason | null;
      ask_calls: number;
      effects: number;
      dry_run: boolean;
    }
);

/**
 * Who fills in each field of each SPEC §10 event. Every event also has the
 * common fields (ts, run_id, skill, skill_hash, host, from the host; section
 * and line from the core's `at`). tests/step.test.ts checks this table
 * covers contracts/event.schema.json exactly.
 */
export const EVENT_FIELDS: Record<string, { core: string[]; host: string[] }> = {
  run: { core: ["cmd", "exit", "timed_out", "after_would_do"], host: ["ms", "truncated", "stdout_hash", "stdout_tail"] },
  check_cmd: { core: ["cmd", "exit", "timed_out", "after_would_do"], host: ["ms", "truncated", "stdout_hash", "stdout_tail"] },
  check: { core: ["expr", "left", "right", "result", "after_would_do"], host: [] },
  ask: {
    core: ["question", "kind", "probs", "chosen", "confidence", "sure", "passed", "range", "detail", "after_would_do"],
    host: ["backend", "model", "ms", "request_path", "request_sha256"],
  },
  effect_start: { core: ["cmd"], host: [] },
  effect_end: { core: ["cmd", "exit", "timed_out"], host: ["ms"] },
  would_do: { core: ["cmd"], host: [] },
  page: { core: ["text", "ok"], host: [] },
  would_page: { core: ["text"], host: [] },
  transfer: { core: ["from", "to"], host: [] },
  outcome: { core: ["outcome", "reason", "ask_calls", "effects", "dry_run"], host: [] },
  // Host-only events: the core never emits these.
  run_start: { core: [], host: ["params", "dry_run", "caller", "run_dir", "skop_version", "skop_build"] },
  handoff_page: { core: [], host: ["text", "ok"] },
  handoff_record: { core: [], host: ["path", "record"] },
  error: { core: [], host: ["code", "stage", "file", "message"] },
  warning: { core: [], host: ["code", "stage", "file", "message"] },
  locked: { core: [], host: ["holder_pid"] },
  stale_lock: { core: [], host: ["path", "holder_pid"] },
};
export const COMMON_FIELDS = { core: ["section", "line"], host: ["ts", "run_id", "skill", "skill_hash", "host"] };

export interface RunConfig {
  params: Record<string, Val>;
  builtins: Record<string, Val>;
  dry: boolean;
  mode: "concrete" | "explore";
}

/** Which responses answer which request (Answers in core/Step.dfy). */
export const ANSWERS: Record<Next["kind"], Response["kind"][]> = {
  exec: ["exec"],
  ask: ["answer", "ask_failed"],
  page: ["page"],
  choose: ["picked"],
  done: [],
};
