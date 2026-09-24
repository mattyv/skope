// P1-P6 (SPEC §5.3) over whole runs.
//
// A run is Start, then Step until Done, each response coming from a host.
// A host may answer however it likes, including a deadline at any point,
// as long as each response answers the request it's given: Step's
// precondition. The step index lets a host vary its answers over a run,
// so these cover every sequence of responses.
//
// The per-step facts live in Run.dfy (Post) and Lemmas.dfy; the invariant
// they carry (SkopeState.Inv) is what makes them hold for a whole run: the
// dry-run flag, the program and the config never change, and the
// variables stay modelled by B's analysis.
module SkopeProofs {
  import opened SkopeAst
  import opened SkopeStep
  import opened SkopeWellFormed
  import opened SkopeValues
  import opened SkopeState
  import opened SkopeLemmas
  import opened SkopeRun

  type Host = (nat, Option<Next>) -> Response

  // Every response a host gives answers the request it's given.
  ghost predicate Answering(h: Host) {
    forall i: nat, last: Option<Next> | last.None? || !last.value.Done? ::
      var r := h(i, last);
      r.DeadlineExceeded? || (if last.None? then r.NoResponse? else Answers(last.value, r))
  }

  // One run from s: every state Step was called on, the requests and the
  // events it returned, and where it ended.
  datatype Trace = Trace(states: seq<State>, nexts: seq<Next>, events: seq<CoreEvent>, final: State)

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
    ensures t.final.log == s.log + t.events
    decreases Measure(s)
  {
    MeasurePos(s);
    var r := h(i, s.last);
    var res := Step(s, r);
    if res.2.Done? then Trace([s], [res.2], res.1, res.0)
    else
      var t := RunFrom(res.0, h, i + 1);
      Trace([s] + t.states, [res.2] + t.nexts, res.1 + t.events, t.final)
  }

  lemma MeasurePos(s: State) requires Inv(s) && !IsDone(s) ensures Measure(s) >= 1 {
    if Pending(s) { assert Rem(s.prog, s.tasks) >= OpCost(s.prog, s.tasks[0].op) >= 1; }
  }

  ghost function RunOf(p: Program, cfg: RunConfig, h: Host): Trace
    requires ProgOk(p, cfg) && Answering(h)
  {
    RunFrom(Start(p, cfg), h, 0)
  }

  // Everything Step returned over a run is exactly the log.
  lemma EventsAreLog(p: Program, cfg: RunConfig, h: Host)
    requires ProgOk(p, cfg) && Answering(h)
    ensures RunOf(p, cfg, h).events == RunOf(p, cfg, h).final.log
  {}

  // P1 Termination: whatever the host answers, the run reaches Done within
  // a bound computable from the program.
  lemma P1_Termination(p: Program, cfg: RunConfig, h: Host)
    requires ProgOk(p, cfg) && Answering(h)
    ensures var t := RunOf(p, cfg, h); |t.nexts| <= StepBound(p) && t.nexts[|t.nexts| - 1].Done?
  {}

  // P2 One outcome: Done is returned exactly once, as the last request, and
  // the events Step returns hold exactly one outcome event, last. Step after
  // Done isn't allowed (Step requires !IsDone).
  lemma P2_OneOutcome(p: Program, cfg: RunConfig, h: Host)
    requires ProgOk(p, cfg) && Answering(h)
    ensures var t := RunOf(p, cfg, h);
      |t.nexts| > 0 && t.nexts[|t.nexts| - 1].Done? && (forall k | 0 <= k < |t.nexts| - 1 :: !t.nexts[k].Done?)
      && IsDone(t.final)
      && |t.events| > 0 && t.events[|t.events| - 1].body.OutcomeEv?
      && forall k | 0 <= k < |t.events| - 1 :: !t.events[k].body.OutcomeEv?
  {
    EventsAreLog(p, cfg, h);
  }

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
      && forall e <- t.events :: !e.body.EffectStartEv? && !e.body.PageEv?
  {
    var t := RunOf(p, cfg, h);
    EventsAreLog(p, cfg, h);
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

  // P4, the context (SPEC §3.5, §6.3): an ask's context holds exactly the
  // question's names that may hold run output: each bound one with its
  // current value, each unbound one as "(unavailable)"; a trusted value
  // never goes there.
  lemma P4_Context(s: State)
    requires Inv(s) && Pending(s) && s.last.value.AskNext?
    ensures s.tasks[0].op.S? && Stmt0(s).Ask?
    ensures var q, ctx := Stmt0(s).question, s.last.value.request.context;
      (forall x | x in ctx :: x in PartVars(q))
      && forall x | x in PartVars(q) ::
           (x in s.vars && s.vars[x].b.origin == FromRunOutput ==> x in ctx && ctx[x] == Show(s.vars[x].b.value))
           && (x !in s.vars && x in RunNames(s.prog) ==> x in ctx && ctx[x] == SkopeState.Unavailable)
           && (x in s.vars && s.vars[x].b.origin != FromRunOutput ==> x !in ctx)
           && (x !in s.vars && x !in RunNames(s.prog) ==> x !in ctx)
  {
    Ready(s);
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

  // The slot a passed gate binds (SPEC §4.2): yes/no and one of bind the
  // chosen option's id as a string, a Score its level as an integer.
  ghost function AnswerSlot(form: AskForm, ids: seq<string>, c: nat): Slot
    requires !form.Sections? && c < |ids|
  {
    match form
    case YesNo(_) => Slot(Bound(Str(ids[c]), FromYesNo), None, KYesNo)
    case OneOf(l, _) => Slot(Bound(Str(ids[c]), FromListItem), None, KValue(l.id))
    case Score(lo, _, _, _) => Slot(Bound(Int(lo + c), FromScore), None, KScore)
  }

  // The state a bound answer carries the run on from: the ask's state,
  // logged and counted, with name bound to sl and the ask done.
  ghost function Bound1(s: State, e: CoreEvent, name: Name, sl: Slot): State
    requires |s.tasks| > 0
  {
    var s1 := s.(last := None, askCalls := s.askCalls + 1, log := s.log + [e]);
    s1.(tasks := s1.tasks[1..], vars := s1.vars[name := sl])
  }

  // P5, what an answer binds: a passed gate on a yes/no, one of or Score
  // ask, or a failed one with `else skip` (yes/no only: it binds "no",
  // SPEC §4.2), carries the run on from exactly the ask's state with that
  // one name bound; nothing else changes but the log and the ask count.
  lemma P5_Binds(s: State, r: Response)
    requires Inv(s) && Pending(s) && s.last.value.AskNext? && r.AskAnswer?
    ensures s.tasks[0].op.S? && Stmt0(s).Ask?
    ensures var v := Gate(Ids(s.last.value.request.options), r.probs, r.unassigned, Stmt0(s).sure);
      !v.Invalid? ==> v.chosen < |Ids(s.last.value.request.options)|
    ensures var st, req, res := Stmt0(s), s.last.value.request, Step(s, r);
      var ids := Ids(req.options);
      var v := Gate(ids, r.probs, r.unassigned, st.sure);
      v.Sure? && !st.form.Sections? ==>
        |res.1| > 0
        && var s2 := Bound1(s, res.1[0], st.form.binding, AnswerSlot(st.form, ids, v.chosen));
           Idle(s2) && res == (Advance(s2).0, [res.1[0]] + Advance(s2).1, Advance(s2).2)
    ensures var st, req, res := Stmt0(s), s.last.value.request, Step(s, r);
      var v := Gate(Ids(req.options), r.probs, r.unassigned, st.sure);
      v.Unsure? && st.els.Skip? ==>
        st.form.YesNo? && |res.1| > 0
        && var s2 := Bound1(s, res.1[0], st.form.binding, Slot(Bound(Str("no"), FromYesNo), None, KYesNo));
           Idle(s2) && res == (Advance(s2).0, [res.1[0]] + Advance(s2).1, Advance(s2).2)
  {
    var st, req := Stmt0(s), s.last.value.request;
    var ids := Ids(req.options);
    Ready(s);
    GateSound(ids, r.probs, r.unassigned, st.sure);
    var v := Gate(ids, r.probs, r.unassigned, st.sure);
    if v.Sure? && !st.form.Sections? { P5Pass(s, r); }
    if v.Unsure? && st.els.Skip? { P5Skip(s, r); }
  }

  lemma P5Pass(s: State, r: Response)
    requires Inv(s) && Pending(s) && s.last.value.AskNext? && r.AskAnswer?
    requires s.tasks[0].op.S? && Stmt0(s).Ask? && !Stmt0(s).form.Sections?
    requires Gate(Ids(s.last.value.request.options), r.probs, r.unassigned, Stmt0(s).sure).Sure?
    ensures var st, req, res := Stmt0(s), s.last.value.request, Step(s, r);
      var ids := Ids(req.options);
      var c := Gate(ids, r.probs, r.unassigned, st.sure).chosen;
      c < |ids| && |res.1| > 0
      && var s2 := Bound1(s, res.1[0], st.form.binding, AnswerSlot(st.form, ids, c));
         Idle(s2) && res == (Advance(s2).0, [res.1[0]] + Advance(s2).1, Advance(s2).2)
  {
    var st, req := Stmt0(s), s.last.value.request;
    var ids := Ids(req.options);
    GateSound(ids, r.probs, r.unassigned, st.sure);
    StepAnswered(s, r);
    var s1 := s.(last := None, askCalls := s.askCalls + 1);
    var v := Gate(ids, r.probs, r.unassigned, st.sure);
    assert Answered(s1, st, req, r) == GatePassed(s1, st, req, r, v.chosen, v.conf);
    var e := Ev(s1, AskEv(req.question, req.kind, Some(r.probs), Some(ChosenOf(st.form, ids, v.chosen)), Some(v.conf), st.sure, true, Range(st.form), None, s1.afterWouldDo));
    assert GatePassed(s1, st, req, r, v.chosen, v.conf) == SkopeRun.Then(e, Accept(Log(s1, e), v.chosen));
    AcceptAdvance(Log(s1, e), v.chosen);
    assert Log(s1, e) == s.(last := None, askCalls := s.askCalls + 1, log := s.log + [e]);
  }

  // A passed gate binds AnswerSlot and carries on.
  lemma AcceptAdvance(t: State, c: nat)
    requires Idle(t) && t.tasks[0].op.S? && Stmt0(t).Ask? && !Stmt0(t).form.Sections?
    requires FormOk(t.prog, Stmt0(t).form) && c < |Options(t.prog, Stmt0(t).form)|
    ensures var form := Stmt0(t).form;
      var t2 := t.(tasks := t.tasks[1..], vars := t.vars[form.binding := AnswerSlot(form, Ids(Options(t.prog, form)), c)]);
      Idle(t2) && Accept(t, c) == Advance(t2)
  {
    var p, form := t.prog, Stmt0(t).form;
    Ready(t);
    OptionsLen(p, form);
    if form.OneOf? { ValueOptsIds(DataList(p, form.list.id).items, c); }
  }

  lemma P5Skip(s: State, r: Response)
    requires Inv(s) && Pending(s) && s.last.value.AskNext? && r.AskAnswer?
    requires s.tasks[0].op.S? && Stmt0(s).Ask? && Stmt0(s).els.Skip?
    requires Gate(Ids(s.last.value.request.options), r.probs, r.unassigned, Stmt0(s).sure).Unsure?
    ensures var st, res := Stmt0(s), Step(s, r);
      st.form.YesNo? && |res.1| > 0
      && var s2 := Bound1(s, res.1[0], st.form.binding, Slot(Bound(Str("no"), FromYesNo), None, KYesNo));
         Idle(s2) && res == (Advance(s2).0, [res.1[0]] + Advance(s2).1, Advance(s2).2)
  {
    var st, req := Stmt0(s), s.last.value.request;
    var ids := Ids(req.options);
    GateSound(ids, r.probs, r.unassigned, st.sure);
    StepAnswered(s, r);
    var s1 := s.(last := None, askCalls := s.askCalls + 1);
    var v := Gate(ids, r.probs, r.unassigned, st.sure);
    assert Answered(s1, st, req, r) == GateMissed(s1, st, req, r, v.chosen, v.conf);
    var e := Ev(s1, AskEv(req.question, req.kind, Some(r.probs), Some(ChosenOf(st.form, ids, v.chosen)), Some(v.conf), st.sure, false, Range(st.form), None, s1.afterWouldDo));
    assert GateMissed(s1, st, req, r, v.chosen, v.conf) == SkopeRun.Then(e, GateMiss(Log(s1, e)));
    SkipAdvance(Log(s1, e));
    assert Log(s1, e) == s.(last := None, askCalls := s.askCalls + 1, log := s.log + [e]);
  }

  // A failed gate with `else skip` binds "no" and carries on.
  lemma SkipAdvance(t: State)
    requires Idle(t) && t.tasks[0].op.S? && Stmt0(t).Ask? && Stmt0(t).els.Skip?
    ensures Stmt0(t).form.YesNo?
    ensures var t2 := t.(tasks := t.tasks[1..], vars := t.vars[Stmt0(t).form.binding := Slot(Bound(Str("no"), FromYesNo), None, KYesNo)]);
      Idle(t2) && GateMiss(t) == Advance(t2)
  {
    Ready(t);
    AskOkIn(t);
  }

  lemma ValueOptsIds(items: seq<Item>, c: nat)
    requires (forall it <- items :: it.Value?) && c < |items|
    ensures ValueOpts(items)[c].id == items[c].value
  {
    if c > 0 { ValueOptsIds(items[1..], c - 1); }
  }

  // Step on an answer is Answered on the state after the count.
  lemma StepAnswered(s: State, r: Response)
    requires Inv(s) && Pending(s) && s.last.value.AskNext? && r.AskAnswer?
    ensures s.tasks[0].op.S? && Stmt0(s).Ask?
    ensures var s1 := s.(last := None, askCalls := s.askCalls + 1);
      Idle(s1) && FormOk(s.prog, Stmt0(s).form) && s.last.value.request.options == Options(s.prog, Stmt0(s).form)
      && Step(s, r) == Answered(s1, Stmt0(s), s.last.value.request, r)
  {
    Ready(s);
    CountOk(s.(last := None), s.(last := None, askCalls := s.askCalls + 1));
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

  // P6 for every state the invariant allows, not only those between Steps.
  // Every state Step's helpers work on inside one Step (Advance, Compare,
  // WouldDo, Continue, a loop's Bind and Unbind) is Idle, so Inv, so this
  // covers the comparisons, `do item`s, `if yes`s and loop binds run inside
  // a Step too.
  lemma P6_EveryState(s: State)
    requires Inv(s) && !IsDone(s)
    ensures NamesReady(s)
  {
    ReadyNames(s);
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
