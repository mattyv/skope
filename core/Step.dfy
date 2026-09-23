// The interface between the core and the host (SPEC §5.2): what Start
// takes, what Step returns, and what the host sends back. Types only; stream
// C implements Start and Step against them and proves P1-P6 (SPEC §5.3).
//
// Phase 0 contract, mirrored by the TypeScript types in src/step.ts.
module SkopStep {
  import opened SkopAst

  // Where a bound value came from (SPEC §3.5). Decides at run time how a
  // name is shown in a question: trusted values are pasted in, run output
  // is named in backticks and sent as context.
  datatype Origin = FromParam | FromBuiltin | FromListItem | FromYesNo | FromScore | FromRunOutput

  datatype Val = Str(s: string) | Int(i: int)
  datatype Bound = Bound(value: Val, origin: Origin)

  // P4 is stated over this ghost record of how each command string was
  // built: every piece is an author literal, or a trusted value that
  // passed the safe-value check (SPEC §3.5). It isn't compiled.
  datatype Piece = AuthorLit(s: string) | Trusted(s: string, origin: Origin)

  datatype ExecKind = RunExec | DoExec | CheckExec

  datatype AskKind = Choice | YesNoKind | ScoreKind
  // `text` is the option's label (label is a Dafny keyword).
  datatype AskOpt = AskOpt(id: string, text: string, description: Option<string>)
  // contracts/ask.schema.json#/$defs/request. `question` is rendered;
  // `context` holds exactly the run outputs it names (SPEC §6.3).
  datatype AskRequest = AskRequest(
    kind: AskKind,
    question: string,
    guidance: Option<string>,
    options: seq<AskOpt>,
    context: map<Name, string>,
    timeoutMs: nat)

  datatype Reason = Explicit | GateFailed | CommandFailed | AskUnavailable | Deadline
  // `detail` is carried into the handoff record (SPEC §8.1).
  datatype Outcome = Stopped | Paged | Handoff(reason: Reason, detail: Option<string>)

  datatype Next =
    | Exec(cmd: string, kind: ExecKind, timeoutMs: nat, src: Src, ghost pieces: seq<Piece>)
    | AskNext(request: AskRequest, src: Src)
    | PageNext(text: string, src: Src)
    | Choose(n: nat) // explore mode only (SPEC §5.4)
    | Done(outcome: Outcome)

  // What the host sends back. Each Next has exactly one matching Response;
  // Start is followed by NoResponse, and so is every Step that returned no request.
  datatype AskFailure = Unavailable | RequestTooLarge
  datatype Response =
    | NoResponse
    // exit is None when the command timed out or was killed.
    | ExecResult(exit: Option<int>, stdout: string, stderrTail: string, timedOut: bool)
    // probs keyed by option id; validated by the core (SPEC §6.1, P5).
    | AskAnswer(probs: map<string, real>, unassigned: real, backend: string, model: string, ms: nat)
    | AskFailed(error: AskFailure, backend: string)
    | PageResult(ok: bool)
    | Picked(i: nat)          // answers Choose(n), i < n
    | DeadlineExceeded        // the host may send this instead of any response

  datatype Mode = Concrete | Explore

  datatype RunConfig = RunConfig(
    params: map<Name, Val>,   // after --param overrides and coercion
    builtins: map<Name, Val>, // host, run_id, … (SPEC §3.5)
    dry: bool,
    mode: Mode)

  // A lint finding: a §7.1 code and the line it points at.
  datatype LintError = LintError(code: string, src: Src)

  predicate Answers(n: Next, r: Response) {
    r.DeadlineExceeded? ||
    match n
    case Exec(_, _, _, _, _) => r.ExecResult?
    case AskNext(_, _) => r.AskAnswer? || r.AskFailed?
    case PageNext(_, _) => r.PageResult?
    case Choose(k) => r.Picked? && r.i < k
    case Done(_) => false
  }
}
