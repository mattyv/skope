// The core/host interface (SPEC §5.2) as the host sees it: a mirror of
// core/Step.dfy. The adapter (src/core.ts) converts between these and the
// compiled Dafny values. tests/step.test.ts keeps the constructor names in
// step with the Dafny file and the event contract.

export const REASONS = ["explicit", "gate_failed", "command_failed", "ask_unavailable", "deadline"] as const;
export type Reason = (typeof REASONS)[number];

export type Outcome = { kind: "stopped" } | { kind: "paged" } | { kind: "handoff"; reason: Reason; detail: string | null };

export type ExecKind = "run" | "do" | "check";

export interface AskRequest {
  kind: "choice" | "yesno" | "score";
  question: string;
  guidance: string | null;
  options: { id: string; label: string; description: string | null }[];
  context: Record<string, string>;
  timeout_ms: number;
}

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
