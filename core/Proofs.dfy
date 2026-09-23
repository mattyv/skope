// P1-P6 (SPEC §5.3) over whole runs.
//
// A run is Start, then Step until Done, each response coming from a host.
// A host may answer however it likes, including a deadline at any point,
// as long as each response answers the request it's given: Step's
// precondition. The step index lets a host vary its answers over a run,
// so these cover every sequence of responses.
//
// The per-step facts live in Run.dfy (Post) and Lemmas.dfy; the invariant
// they carry (SkopState.Inv) is what makes them hold for a whole run: the
// dry-run flag, the program and the config never change, and the
// variables stay modelled by B's analysis.
module SkopProofs {
  import opened SkopAst
  import opened SkopStep
  import opened SkopWellFormed
  import opened SkopValues
  import opened SkopState
  import opened SkopLemmas
  import opened SkopRun

  type Host = (nat, Option<Next>) -> Response

  // Every response a host gives answers the request it's given.
  ghost predicate Answering(h: Host) {
    forall i: nat, last: Option<Next> | last.None? || !last.value.Done? ::
      var r := h(i, last);
      r.DeadlineExceeded? || (if last.None? then r.NoResponse? else Answers(last.value, r))
  }

  // One run from s: every state Step was called on, what it returned, and where it ended.
  datatype Trace = Trace(states: seq<State>, nexts: seq<Next>, final: State)

  ghost function RunFrom(s: State, h: Host, i: nat): (t: Trace)
    requires Inv(s) && !IsDone(s) && Answering(h)
    ensures |t.states| == |t.nexts| > 0
    ensures t.states[0] == s && |t.nexts| <= Measure(s)
    ensures forall k | 0 <= k < |t.states| ::
              Inv(t.states[k]) && !IsDone(t.states[k]) && t.states[k].prog == s.prog && t.states[k].cfg == s.cfg
    ensures forall k | 0 <= k < |t.nexts| :: NextOk(s.prog, s.cfg, t.nexts[k])
    ensures t.nexts[|t.nexts| - 1].Done? && forall k | 0 <= k < |t.nexts| - 1 :: !t.nexts[k].Done?
    ensures Inv(t.final) && IsDone(t.final) && t.final.prog == s.prog && t.final.cfg == s.cfg
    ensures t.final.last == Some(t.nexts[|t.nexts| - 1])
    decreases Measure(s)
  {
    MeasurePos(s);
    var r := h(i, s.last);
    var res := Step(s, r);
    if res.2.Done? then Trace([s], [res.2], res.0)
    else
      var t := RunFrom(res.0, h, i + 1);
      Trace([s] + t.states, [res.2] + t.nexts, t.final)
  }

  lemma MeasurePos(s: State) requires Inv(s) && !IsDone(s) ensures Measure(s) >= 1 {
    if Pending(s) { assert Rem(s.prog, s.tasks) >= OpCost(s.prog, s.tasks[0].op) >= 1; }
  }

  ghost function RunOf(p: Program, cfg: RunConfig, h: Host): Trace
    requires ProgOk(p, cfg) && Answering(h)
  {
    RunFrom(Start(p, cfg), h, 0)
  }

  // P1 Termination: whatever the host answers, the run reaches Done within
  // a bound computable from the program.
  lemma P1_Termination(p: Program, cfg: RunConfig, h: Host)
    requires ProgOk(p, cfg) && Answering(h)
    ensures var t := RunOf(p, cfg, h); |t.nexts| <= StepBound(p) && t.nexts[|t.nexts| - 1].Done?
  {}

  // P2 One outcome: Done is returned exactly once, as the last request, and
  // the log holds exactly one outcome event, last. Step after Done isn't
  // allowed (Step requires !IsDone).
  lemma P2_OneOutcome(p: Program, cfg: RunConfig, h: Host)
    requires ProgOk(p, cfg) && Answering(h)
    ensures var t := RunOf(p, cfg, h);
      |t.nexts| > 0 && t.nexts[|t.nexts| - 1].Done? && (forall k | 0 <= k < |t.nexts| - 1 :: !t.nexts[k].Done?)
      && IsDone(t.final)
      && |t.final.log| > 0 && t.final.log[|t.final.log| - 1].body.OutcomeEv?
      && forall k | 0 <= k < |t.final.log| - 1 :: !t.final.log[k].body.OutcomeEv?
  {}

  // A command handed out as `kind` is one of the program's commands of that kind.
  ghost predicate CommandOf(p: Program, cfg: RunConfig, n: Next) requires n.Exec? {
    n.cmd == Concat(n.pieces) && FromTemplate(p, cfg, n.kind, n.pieces)
  }

  // P3 Dry run: no Exec with kind `do` and no Page, ever; every command
  // handed out is one of the program's `run` or `check` commands, exactly as
  // written apart from its trusted values; and the log never reports an
  // effect or a page.
  lemma P3_DryRun(p: Program, cfg: RunConfig, h: Host)
    requires ProgOk(p, cfg) && Answering(h) && cfg.dry
    ensures var t := RunOf(p, cfg, h);
      (forall n <- t.nexts :: !n.PageNext? && (n.Exec? ==> n.kind != DoExec && CommandOf(p, cfg, n)))
      && forall e <- t.final.log :: !e.body.EffectStartEv? && !e.body.PageEv?
  {
    var t := RunOf(p, cfg, h);
    forall n <- t.nexts ensures !n.PageNext? && (n.Exec? ==> n.kind != DoExec && CommandOf(p, cfg, n)) {
      var k :| 0 <= k < |t.nexts| && t.nexts[k] == n;
    }
  }

  // P4 Taint: every command is author literals and trusted values that
  // passed the safe-value check; every question is author literals and
  // trusted values, with run output only as a name in backticks and its
  // value in the context.
  lemma P4_Taint(p: Program, cfg: RunConfig, h: Host)
    requires ProgOk(p, cfg) && Answering(h)
    ensures var t := RunOf(p, cfg, h);
      forall n <- t.nexts ::
        (n.Exec? ==> CommandOf(p, cfg, n))
        && (n.AskNext? ==> AskReqOk(p, cfg, n.request))
  {
    var t := RunOf(p, cfg, h);
    forall n <- t.nexts ensures (n.Exec? ==> CommandOf(p, cfg, n)) && (n.AskNext? ==> AskReqOk(p, cfg, n.request)) {
      var k :| 0 <= k < |t.nexts| && t.nexts[k] == n;
    }
  }

  // P5 Answers: the gate (Values.GateSound) passes only on a validated
  // answer, never counts `unassigned` for the chosen option, and fails when
  // it could change the winner; and an answered ask in a run gates exactly
  // that way on exactly the author's options.
  lemma P5_Answers(s: State, r: Response)
    requires Inv(s) && Pending(s) && s.last.value.AskNext? && r.AskAnswer?
    ensures var st := s.tasks[0].op.stmt; var req := s.last.value.request;
      var v := Gate(Ids(req.options), r.probs, r.unassigned, st.sure);
      var res := Step(s, r);
      st.Ask? && FormOk(s.prog, st.form) && req.options == Options(s.prog, st.form)
      && |res.1| > 0 && res.1[0].body.AskEv?
      && res.1[0].body.passed == v.Sure?
      && (v.Invalid? ==> res.2 == Done(Handoff(AskUnavailable, Some("unavailable"))))
      && (v.Sure? ==>
            v.chosen < |req.options|
            && res.1[0].body.chosen == Some(ChosenOf(st.form, Ids(req.options), v.chosen))
            && res.1[0].body.confidence == Some(v.conf)
            && (st.form.Score? ==> st.form.low <= st.form.low + v.chosen <= st.form.high)
            && (st.form.Sections? ==>
                  |res.1| > 1 && res.1[1].body.TransferEv?
                  && res.1[1].body.to == s.prog.sections[st.form.options[v.chosen].ref.id].name))
  {
    Ready(s);
    GateSound(Ids(s.last.value.request.options), r.probs, r.unassigned, s.tasks[0].op.stmt.sure);
    OptionsLen(s.prog, s.tasks[0].op.stmt.form);
  }

  // P6 Lint soundness: from a well-formed program, every state a run
  // reaches satisfies Step's precondition, and the next statement meets
  // B's runtime obligations (SafeAt) in the concrete env the variables
  // make: every name a command, comparison, `do item` or `if yes` reads is
  // bound, with a value of a kind allowed there; every section and list it
  // names exists. There's no internal-error outcome at all.
  lemma P6_LintSoundness(p: Program, cfg: RunConfig, h: Host)
    requires ProgOk(p, cfg) && Answering(h)
    ensures var t := RunOf(p, cfg, h);
      forall s <- t.states :: Inv(s) && !IsDone(s) && NamesReady(s)
  {
    var t := RunOf(p, cfg, h);
    forall s <- t.states ensures Inv(s) && !IsDone(s) && NamesReady(s) {
      var k :| 0 <= k < |t.states| && t.states[k] == s;
      ReadyNames(s);
    }
  }

  ghost predicate NamesReady(s: State) requires Inv(s) && !IsDone(s) {
    var p := s.prog;
    s.tasks[0].op.S? ==>
      var st := s.tasks[0].op.stmt;
      SafeAt(p, st, KindMap(s.vars), s.tasks[0].gov)
      && (forall x <- CmdVars(st) :: x in s.vars && CmdSafe(p, s.cfg, s.vars[x]))
      // A comparison on a Score variable never fails coercion.
      && (forall x <- OperandVars(st) :: x in s.vars && (s.vars[x].kind == KScore ==> Coerce(s.vars[x].b.value).Some?))
      && ((st.Do? || st.IfYesDo?) ==> DoReady(s.vars, st.action))
      && (forall j <- Jumps(st) :: IsInstr(p, j.ref.id))
      && (forall r <- ListRefs(st) :: IsData(p, r.id))
  }

  lemma ReadyNames(s: State)
    requires Inv(s) && !IsDone(s)
    ensures NamesReady(s)
  {
    Ready(s);
    var p := s.prog;
    if s.tasks[0].op.S? {
      var st := s.tasks[0].op.stmt;
      forall x <- CmdVars(st) ensures x in s.vars && CmdSafe(p, s.cfg, s.vars[x]) {
        assert x in CmdNames(p);
        CmdVarSafe(p, s.cfg, s.vars, x);
      }
      forall x <- OperandVars(st) | s.vars[x].kind == KScore ensures Coerce(s.vars[x].b.value).Some? {
        assert SlotOk(p, s.cfg, x, s.vars[x]);
      }
    }
  }

  // The hypotheses aren't vacuous: a program and config meet them.
  lemma Satisfiable() ensures exists p, cfg :: ProgOk(p, cfg) {
    var body := [Run(2, [Lit("uptime")], Some("up"), NoElse), Stop(3)];
    var p := Program("t", Entry("s:a", 1), map[], Limits(1, 1, 1, 1),
                     map["s:a" := Instructions("A", 1, None, body)]);
    var cfg := RunConfig(map[], map["host" := Str("h"), "run_id" := Str("r"), "skill" := Str("t")], true, Concrete);
    assert Flat(body) == body;
    forall st | st in Stmts(p) ensures st == body[0] || st == body[1] {
      var id, x :| id in p.sections && p.sections[id].Instructions? && x in Flat(p.sections[id].body) && x == st;
    }
    assert Ranked(p, map["s:a" := 0]);
    var In := map["s:a" := EntryEnv(p)];
    assert SeqOk(p, In, body, EntryEnv(p), {}, None);
    assert FlowOkWith(p, In);
    assert CmdNames(p) == {};
    assert ProgOk(p, cfg);
  }
}
