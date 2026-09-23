// The interpreter's step function (SPEC §5.2). It's pure: the host calls
// Step, performs the request it returns, and feeds the result back.
// Phase 0 spike: run, do and stop, with dry run.
module SkopInterp {
  import opened SkopSyntax
  import opened SkopLint

  datatype Outcome = Stopped | Handoff(reason: string)

  // Event names follow SPEC §10.
  datatype Event =
    | RunDone(src: nat, cmd: string, exit: int, afterWouldDo: bool)  // `run`
    | EffectStart(src: nat, cmd: string)                             // `effect_start`
    | EffectEnd(src: nat, cmd: string, exit: int)                    // `effect_end`
    | WouldDo(src: nat, cmd: string)                                 // `would_do`
    | Finished(outcome: Outcome)                                     // `outcome`

  datatype Next = Exec(kind: Kind, cmd: string, src: nat) | Done(outcome: Outcome)

  datatype Response = NoResponse | ExecResult(exit: int)

  // waiting: the last Next was an Exec, so the next Step needs its result.
  // done: the run has ended; no further Step is allowed (P2).
  // afterWouldDo: a would_do happened, so later reads are marked (SPEC §4.5).
  datatype State = State(prog: Program, pc: nat, dry: bool, waiting: bool, done: bool, afterWouldDo: bool)

  ghost predicate Valid(s: State) {
    Lint(s.prog) == [] && s.pc < |s.prog.body|
    && (s.waiting ==> !s.prog.body[s.pc].Stop?)
    && !(s.waiting && s.done)
    && (s.afterWouldDo <==> s.dry && DoBefore(s.prog, s.pc))
    && (s.waiting && s.dry ==> s.prog.body[s.pc].Run?)
  }

  // The request a waiting state is for: exactly its statement, labelled by its kind.
  ghost predicate Describes(s: State, n: Next)
    requires s.pc < |s.prog.body|
  {
    n.Exec? ==> var st := s.prog.body[s.pc];
      !st.Stop? && n.cmd == Render(st.cmd) && n.src == st.src && (n.kind == DoKind <==> st.Do?)
  }

  ghost predicate DoBefore(p: Program, pc: nat) {
    exists j :: 0 <= j < pc && j < |p.body| && p.body[j].Do?
  }

  // At most one outcome event, only as the last event, and only with Done.
  ghost predicate OutcomeLast(evs: seq<Event>, n: Next) {
    (forall i :: 0 <= i < |evs| && evs[i].Finished? ==> i == |evs| - 1 && n.Done? && evs[i].outcome == n.outcome)
    && (n.Done? ==> |evs| > 0 && evs[|evs| - 1] == Finished(n.outcome))
  }

  // SPEC 4.5: every run event after a would_do carries after_would_do.
  ghost predicate RunsMarked(p: Program, dry: bool, evs: seq<Event>) {
    forall e <- evs :: e.RunDone? ==>
      (exists j :: 0 <= j < |p.body| && p.body[j].Run? && p.body[j].src == e.src && (e.afterWouldDo <==> dry && DoBefore(p, j)))
  }

  // Strictly decreases on every Step that doesn't end the run, so a run
  // takes at most 2 * |body| Steps (P1).
  function Measure(s: State): nat
    requires s.pc < |s.prog.body|
  {
    2 * (|s.prog.body| - s.pc) - (if s.waiting then 1 else 0)
  }

  function Start(p: Program, dry: bool): (s: State)
    requires Lint(p) == []
    ensures Valid(s) && !s.waiting && !s.done && s.dry == dry && s.prog == p
  {
    CleanEndsInStop(p);
    State(p, 0, dry, false, false, false)
  }

  // Runs forward to the next request or the end. Lint guarantees it never
  // falls off the end of the body, so there is no internal-error case.
  function Advance(s: State): (res: (State, seq<Event>, Next))
    requires Lint(s.prog) == [] && s.pc < |s.prog.body| && !s.waiting && !s.done
    requires s.afterWouldDo <==> s.dry && DoBefore(s.prog, s.pc)
    ensures RunsMarked(s.prog, s.dry, res.1)
    decreases |s.prog.body| - s.pc
    ensures Valid(res.0) && res.0.dry == s.dry && res.0.prog == s.prog
    ensures res.2.Exec? <==> res.0.waiting
    ensures res.2.Done? <==> res.0.done
    ensures res.2.Exec? ==> Measure(res.0) < Measure(s)
    ensures s.dry ==> !(res.2.Exec? && res.2.kind == DoKind)
    ensures Describes(res.0, res.2)
    ensures s.dry ==> (res.2.Exec? ==> res.0.prog.body[res.0.pc].Run?)
    ensures OutcomeLast(res.1, res.2)
  {
    CleanEndsInStop(s.prog);
    match s.prog.body[s.pc]
    case Stop(_) => (s.(done := true), [Finished(Stopped)], Done(Stopped))
    case Run(src, cmd) => (s.(waiting := true), [], Exec(RunKind, Render(cmd), src))
    case Do(src, cmd) =>
      if s.dry then
        assert DoBefore(s.prog, s.pc + 1);
        var r := Advance(s.(pc := s.pc + 1, afterWouldDo := true));
        (r.0, [WouldDo(src, Render(cmd))] + r.1, r.2)
      else
        (s.(waiting := true), [EffectStart(src, Render(cmd))], Exec(DoKind, Render(cmd), src))
  }

  function Step(s: State, r: Response): (res: (State, seq<Event>, Next))
    requires Valid(s) && !s.done
    requires s.waiting <==> r.ExecResult?
    ensures RunsMarked(s.prog, s.dry, res.1)
    ensures Valid(res.0) && res.0.dry == s.dry && res.0.prog == s.prog
    ensures res.2.Exec? <==> res.0.waiting
    ensures res.2.Done? <==> res.0.done
    ensures res.2.Exec? ==> Measure(res.0) < Measure(s)
    // P3 for this step. DryRunNeverDoes lifts it to a whole run.
    ensures s.dry ==> !(res.2.Exec? && res.2.kind == DoKind)
    ensures Describes(res.0, res.2)
    ensures s.dry ==> (res.2.Exec? ==> res.0.prog.body[res.0.pc].Run?)
    ensures OutcomeLast(res.1, res.2)
  {
    CleanEndsInStop(s.prog);
    if !s.waiting then Advance(s)
    else
      var st := s.prog.body[s.pc];
      var cmd := Render(st.cmd);
      var ended := if st.Run? then [RunDone(st.src, cmd, r.exit, s.afterWouldDo)] else [EffectEnd(st.src, cmd, r.exit)];
      if r.exit != 0 then
        (s.(waiting := false, done := true), ended + [Finished(Handoff("command_failed"))], Done(Handoff("command_failed")))
      else
        assert DoBefore(s.prog, s.pc + 1) <==> DoBefore(s.prog, s.pc) || st.Do?;
        var a := Advance(s.(pc := s.pc + 1, waiting := false));
        (a.0, ended + a.1, a.2)
  }

  // A whole run from a waiting state, answering the i-th command with
  // exits[i] (0 once exits runs out). Returns every Next it produced.
  ghost function TraceFrom(s: State, exits: seq<int>): (ns: seq<Next>)
    requires Valid(s) && !s.done && s.waiting
    decreases Measure(s)
    ensures s.dry ==> forall i :: 0 <= i < |ns| ==> !(ns[i].Exec? && ns[i].kind == DoKind)
    ensures s.dry ==> forall n <- ns :: n.Exec? ==> IsRunOf(s.prog, n)
    ensures 0 < |ns| <= Measure(s) && ns[|ns| - 1].Done? && forall i :: 0 <= i < |ns| - 1 ==> ns[i].Exec?
  {
    var r := Step(s, ExecResult(if |exits| > 0 then exits[0] else 0));
    if r.2.Done? then [r.2]
    else [r.2] + TraceFrom(r.0, if |exits| > 0 then exits[1..] else [])
  }

  ghost predicate IsRunOf(p: Program, n: Next) requires n.Exec? {
    exists j :: 0 <= j < |p.body| && p.body[j].Run? && n.cmd == Render(p.body[j].cmd) && n.src == p.body[j].src
  }

  ghost function Trace(p: Program, dry: bool, exits: seq<int>): (ns: seq<Next>)
    requires Lint(p) == []
    ensures dry ==> forall n <- ns :: n.Exec? ==> IsRunOf(p, n)
    ensures 0 < |ns| <= 2 * |p.body| && ns[|ns| - 1].Done? && forall i :: 0 <= i < |ns| - 1 ==> ns[i].Exec?
  {
    var r := Step(Start(p, dry), NoResponse);
    if r.2.Done? then [r.2] else [r.2] + TraceFrom(r.0, exits)
  }

  // P3 (SPEC §5.3) for the spike: in a dry run, every command the whole run
  // hands to the outside world is one of the program's `run` statements,
  // exactly as written and labelled as a run, whatever the commands return.
  // So no `do` ever gets out, under any label.
  lemma DryRunNeverDoes(p: Program, exits: seq<int>)
    requires Lint(p) == []
    ensures forall n <- Trace(p, true, exits) :: n.Exec? ==> n.kind == RunKind && IsRunOf(p, n)
  {}
}
