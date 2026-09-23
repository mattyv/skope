// Error and event output (SPEC §7.1, §10): each error/warning as one JSON
// event on stdout, plus a human-readable line on stderr. `file` and `line`
// are left out when there's no source line (SPEC §7.1).

export type Stage = "parse" | "lint" | "args" | "runtime";

export interface EventContext {
  run_id: string | null;
  skill: string | null;
  skill_hash: string | null;
  host: string;
  section?: string;
  line?: number;
}

export interface Diagnostic {
  code: string;
  stage: Stage;
  file?: string;
  line?: number;
  message: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Drops keys whose value is undefined, so schemas with `additionalProperties: false` accept the result. */
function withoutUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function errorEvent(ctx: EventContext, d: Diagnostic) {
  return withoutUndefined({ ts: nowIso(), event: "error" as const, ...ctx, ...d });
}

export function warningEvent(ctx: EventContext, d: Diagnostic) {
  return withoutUndefined({ ts: nowIso(), event: "warning" as const, ...ctx, ...d });
}

export function lockedEvent(ctx: EventContext, holderPid: number) {
  return withoutUndefined({ ts: nowIso(), event: "locked" as const, ...ctx, holder_pid: holderPid });
}

export function staleLockEvent(ctx: EventContext, path: string, holderPid: number) {
  return withoutUndefined({ ts: nowIso(), event: "stale_lock" as const, ...ctx, path, holder_pid: holderPid });
}

/** The readable stderr line for an error or warning (SPEC §7.1). */
export function diagnosticLine(d: Pick<Diagnostic, "code" | "message" | "file" | "line">): string {
  return d.file !== undefined && d.line !== undefined ? `${d.file}:${d.line}: ${d.code}: ${d.message}` : `${d.code}: ${d.message}`;
}

export interface EventSink {
  emit(event: object): void;
}

/** Writes one JSON Lines event to stdout (SPEC §10). */
export function stdoutSink(write: (s: string) => void = (s) => process.stdout.write(s)): EventSink {
  return {
    emit(event) {
      write(`${JSON.stringify(event)}\n`);
    },
  };
}

export function reportError(sink: EventSink, stderrWrite: (s: string) => void, ctx: EventContext, d: Diagnostic): void {
  const ev = errorEvent(ctx, d);
  sink.emit(ev);
  stderrWrite(`${diagnosticLine(d)}\n`);
}

export function reportWarning(sink: EventSink, stderrWrite: (s: string) => void, ctx: EventContext, d: Diagnostic): void {
  const ev = warningEvent(ctx, d);
  sink.emit(ev);
  stderrWrite(`${diagnosticLine(d)}\n`);
}
