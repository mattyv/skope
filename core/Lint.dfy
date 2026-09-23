// Static checks (SPEC §4.1, §7.1). Phase 0 spike: E-FALLS-OFF and
// E-UNREACHABLE only.
module SkopLint {
  import opened SkopSyntax

  datatype LintError = LintError(code: string, src: nat)

  // Every path must end in stop; here, the last instruction must be one.
  function FallsOff(body: seq<Stmt>): seq<LintError> {
    if |body| == 0 then [LintError("E-FALLS-OFF", 0)]
    else if body[|body| - 1].Stop? then []
    else [LintError("E-FALLS-OFF", body[|body| - 1].src)]
  }

  // An instruction straight after a stop can never run.
  function Unreachable(body: seq<Stmt>, i: nat): seq<LintError>
    decreases |body| - i
  {
    if i + 1 >= |body| then []
    else if body[i].Stop? then [LintError("E-UNREACHABLE", body[i + 1].src)] + Unreachable(body, i + 1)
    else Unreachable(body, i + 1)
  }

  function Lint(p: Program): seq<LintError> {
    FallsOff(p.body) + Unreachable(p.body, 0)
  }

  // What a clean lint guarantees the interpreter: the body ends in stop.
  lemma CleanEndsInStop(p: Program)
    requires Lint(p) == []
    ensures |p.body| > 0 && p.body[|p.body| - 1].Stop?
  {}
}
