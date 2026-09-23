// The interpreter's step function (SPEC §5.2). It's pure: the host calls
// Step, performs the request it returns, and feeds the result back.
// Phase 0 spike: run, do and stop, with dry run.
module SkopInterp {
  import opened SkopSyntax
  import opened SkopLint

  datatype Outcome = Stopped | Handoff(reason: string)

  datatype Event =
    | WouldDo(src: nat, cmd: string)
    | EffectStart(src: nat, cmd: string)
    | Ran(src: nat, kind: Kind, cmd: string, exit: int)
    | Finished(outcome: Outcome)

  datatype Next = Exec(kind: Kind, cmd: string, src: nat) | Done(outcome: Outcome)

  datatype Response = NoResponse | ExecResult(exit: int)

  // waiting: the last Next was an Exec, so the next Step needs its result.
  datatype State = State(prog: Program, pc: nat, dry: bool, waiting: bool)

  ghost predicate Valid(s: State) {
    Lint(s.prog) == [] && s.pc < |s.prog.body| && (s.waiting ==> !s.prog.body[s.pc].Stop?)
  }

  function Start(p: Program, dry: bool): (s: State)
    requires Lint(p) == []
    ensures Valid(s) && !s.waiting
  {
    CleanEndsInStop(p);
    State(p, 0, dry, false)
  }

  function KindOf(st: Stmt): Kind
    requires !st.Stop?
  {
    if st.Run? then RunKind else DoKind
  }

  // Runs forward to the next request or the end. Lint guarantees it never
  // falls off the end of the body, so there is no "internal error" case.
  function Advance(s: State): (res: (State, seq<Event>, Next))
    requires Lint(s.prog) == [] && s.pc < |s.prog.body| && !s.waiting
    decreases |s.prog.body| - s.pc
    ensures res.2.Exec? ==> Valid(res.0) && res.0.waiting
    // P3 (SPEC §5.3): in dry run, a do is never handed to the outside world.
    ensures s.dry ==> !(res.2.Exec? && res.2.kind == DoKind)
  {
    CleanEndsInStop(s.prog);
    match s.prog.body[s.pc]
    case Stop(_) => (s, [Finished(Stopped)], Done(Stopped))
    case Run(src, cmd) => (s.(waiting := true), [], Exec(RunKind, cmd, src))
    case Do(src, cmd) =>
      if s.dry then
        var r := Advance(s.(pc := s.pc + 1));
        (r.0, [WouldDo(src, cmd)] + r.1, r.2)
      else
        (s.(waiting := true), [EffectStart(src, cmd)], Exec(DoKind, cmd, src))
  }

  function Step(s: State, r: Response): (res: (State, seq<Event>, Next))
    requires Valid(s)
    requires s.waiting <==> r.ExecResult?
    ensures res.2.Exec? ==> Valid(res.0) && res.0.waiting
    ensures s.dry ==> !(res.2.Exec? && res.2.kind == DoKind)
  {
    CleanEndsInStop(s.prog);
    if !s.waiting then Advance(s)
    else
      var st := s.prog.body[s.pc];
      var ran := [Ran(st.src, KindOf(st), st.cmd, r.exit)];
      if r.exit != 0 then
        (s, ran + [Finished(Handoff("command_failed"))], Done(Handoff("command_failed")))
      else
        var a := Advance(s.(pc := s.pc + 1, waiting := false));
        (a.0, ran + a.1, a.2)
  }
}
