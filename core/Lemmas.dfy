// The step lemmas: each move Step makes keeps the invariant (SkopeState.Inv)
// and lowers the measure. SkopeRun calls them; Proofs.dfy builds P1-P6 on them.
module SkopeLemmas {
  import opened SkopeAst
  import opened SkopeStep
  import opened SkopeWellFormed
  import opened SkopeValues
  import opened SkopeState

  // ---- the log ----

  ghost predicate Plain(s: State, e: CoreEvent) {
    !e.body.OutcomeEv? && !e.body.WouldDoEv?
    && (IsRead(e.body) ==> e.body.afterWouldDo == s.afterWouldDo)
    && (s.cfg.dry ==> !e.body.EffectStartEv? && !e.body.PageEv?)
  }

  // Logging an event that isn't an outcome or a would_do.
  lemma LoggedOk(s: State, s2: State, e: CoreEvent)
    requires Inv(s) && !IsDone(s) && Plain(s, e)
    requires s2 == s.(log := s.log + [e], effects := s2.effects, askCalls := s2.askCalls)
    ensures Inv(s2)
  {
    var log2 := s2.log;
    assert forall j | 0 <= j < |s.log| :: log2[j] == s.log[j];
    assert (exists j | 0 <= j < |log2| :: log2[j].body.WouldDoEv?) == (exists j | 0 <= j < |s.log| :: s.log[j].body.WouldDoEv?);
    assert (exists j | 0 <= j < |log2| :: log2[j].body.OutcomeEv?) == (exists j | 0 <= j < |s.log| :: s.log[j].body.OutcomeEv?);
    if Pending(s) { IssueNextSame(s, s2); }
  }

  // Logging a would_do (SPEC §4.5): later reads are marked.
  lemma WouldDoLogOk(s: State, s2: State, e: CoreEvent)
    requires Inv(s) && s.last.None? && e.body.WouldDoEv? && s.cfg.dry
    requires s2 == s.(log := s.log + [e], afterWouldDo := true, effects := s2.effects)
    ensures Inv(s2)
  {
    var log2 := s2.log;
    assert forall j | 0 <= j < |s.log| :: log2[j] == s.log[j];
    assert log2[|s.log|].body.WouldDoEv?;
    assert (exists j | 0 <= j < |log2| :: log2[j].body.OutcomeEv?) == (exists j | 0 <= j < |s.log| :: s.log[j].body.OutcomeEv?);
  }

  // Handing out a request.
  lemma IssueOk(s: State, s2: State, evs: seq<CoreEvent>)
    requires Idle(s) && Issues(s) && (evs == [] || (|evs| == 1 && Plain(s, evs[0])))
    requires s2 == s.(log := s.log + evs, effects := s2.effects, last := Some(IssueNext(s)))
    ensures Inv(s2)
  {
    IssueNextSame(s, s2);
    var s1 := s.(log := s.log + evs, effects := s2.effects);
    if evs == [] { assert s1 == s.(effects := s2.effects); CountOk(s, s1); } else { LoggedOk(s, s1, evs[0]); }
    assert s2 == s1.(last := Some(IssueNext(s)));
  }

  // Ending the run: the outcome event comes last, and only once (P2).
  lemma FinishOk(s: State, s2: State, e: CoreEvent)
    requires Idle(s) && e.body.OutcomeEv?
    requires s2 == s.(last := Some(Done(e.body.outcome)), log := s.log + [e])
    ensures Inv(s2)
  {
    var log2 := s2.log;
    assert forall j | 0 <= j < |s.log| :: log2[j] == s.log[j];
    assert (exists j | 0 <= j < |log2| :: log2[j].body.WouldDoEv?) == (exists j | 0 <= j < |s.log| :: s.log[j].body.WouldDoEv?);
    assert log2[|s.log|].body.OutcomeEv?;
  }

  lemma CountOk(s: State, s2: State)
    requires Inv(s) && s2 == s.(askCalls := s2.askCalls, effects := s2.effects)
    ensures Inv(s2)
  {
    if Pending(s) { IssueNextSame(s, s2); }
  }

  // IssueNext reads only the program, config, section, tasks and variables.
  lemma IssueNextSame(s: State, s2: State)
    requires Running(s) && Issues(s)
    requires s2.prog == s.prog && s2.cfg == s.cfg && s2.sec == s.sec && s2.tasks == s.tasks && s2.vars == s.vars
    requires s2.runNames == s.runNames
    ensures Running(s2) && Issues(s2) && IssueNext(s2) == IssueNext(s)
  {}

  // ---- starting, moving on, transferring ----

  lemma StartOk(p: Program, cfg: RunConfig)
    requires ProgOk(p, cfg)
    ensures Idle(StartState(p, cfg)) && StartState(p, cfg).log == [] && Measure(StartState(p, cfg)) < StepBound(p)
  {
    var id, In := p.entry.section, TheIn(p);
    SectionTasks(p, cfg, id);
    var vars := InitVars(cfg);
    assert KindMap(vars) == Initial(p);
    EntrySim(p);
    HoldsApprox(In[id], EntryEnv(p), Initial(p));
    BelowSum(p, id, InstrIds(p));
  }

  // A section's body as tasks, from B's env on entry to it.
  lemma SectionTasks(p: Program, cfg: RunConfig, id: SectionId)
    requires ProgOk(p, cfg) && id in TheIn(p)
    ensures IsInstr(p, id)
    ensures var ts := Tasks(p, Body(p, id), None, TheIn(p)[id], {});
      |ts| > 0 && Ends(ts) && AllOk(p, cfg, id, ts) && Chain(p, ts) && Scoped(ts) && ts[0].E == TheIn(p)[id]
      && Rem(p, ts) == CostBody(p, Body(p, id))
  {
    var b := Body(p, id);
    FlatHas(b);
    TasksShape(p, b, None, TheIn(p)[id], {});
    TasksTyped(p, cfg, id, b, None, TheIn(p)[id], {});
    var ts := Tasks(p, b, None, TheIn(p)[id], {});
    assert ts[|ts| - 1].op == S(b[|b| - 1]);
    NoLoopVars(ts);
  }

  lemma ContinueOk(s: State, vars2: Vars)
    requires Idle(s) && !(s.tasks[0].op.S? && Terminal(s.tasks[0].op.stmt))
    requires Models(vars2, AfterOp(s.prog, s.tasks[0].op, s.tasks[0].E)) && VarsOk(s.prog, s.cfg, vars2)
    ensures Idle(s.(tasks := s.tasks[1..], vars := vars2))
    ensures Busy(s.(tasks := s.tasks[1..], vars := vars2)) + 1 < Busy(s)
  {
    var ts := s.tasks;
    var k :| 0 <= k < |ts| && ts[k].op.S? && Terminal(ts[k].op.stmt);
    assert k > 0 && ts[1..][k - 1] == ts[k];
    HoldsApprox(ts[1].E, AfterOp(s.prog, ts[0].op, ts[0].E), KindMap(vars2));
    forall j | 0 <= j < |ts| - 1 && ts[1..][j].op.S? ensures ts[1..][j].lv == LoopVars(ts[1..][j + 1..]) {
      assert ts[1..][j + 1..] == ts[j + 2..];
    }
  }

  // A transfer out of the first statement: the target, the variables it
  // leaves (the loop variables in scope dropped: B's TransferEnv), and the
  // rank going down.
  lemma JumpOk(s: State, j: Jump)
    requires Idle(s) && s.tasks[0].op.S? && j in Jumps(Stmt0(s))
    ensures IsInstr(s.prog, j.ref.id) && j.ref.id in TheIn(s.prog)
    ensures Models(s.vars - LoopVars(s.tasks), TheIn(s.prog)[j.ref.id])
    ensures SumW(s.prog, Below(s.prog, j.ref.id)) + Weight(s.prog, j.ref.id) <= Base(s)
  {
    var p, t, st, id := s.prog, s.tasks[0], Stmt0(s), j.ref.id;
    Ready(s);
    var r := TheRank(p);
    assert r[id] < r[s.sec];
    LoopVarsSplit([t], s.tasks[1..]);
    assert [t] + s.tasks[1..] == s.tasks;
    var c, c' := KindMap(s.vars), KindMap(s.vars - LoopVars(s.tasks));
    assert TransferEnv(st, c, t.lv, c');
    StmtSim(p, TheIn(p), st, t.E, t.lv, t.gov, c);
    BelowSum(p, id, Below(p, s.sec));
  }

  lemma EnterOk(s: State, id: SectionId, e: CoreEvent)
    requires Idle(s) && id in TheIn(s.prog) && Models(s.vars - LoopVars(s.tasks), TheIn(s.prog)[id])
    requires e.body.TransferEv?
    requires IsInstr(s.prog, id) && SumW(s.prog, Below(s.prog, id)) + Weight(s.prog, id) <= Base(s)
    ensures Idle(Enter(s, id, e)) && Busy(Enter(s, id, e)) + 1 < Base(s)
  {
    SectionTasks(s.prog, s.cfg, id);
    LoggedOk(s, s.(log := s.log + [e]), e);
    assert VarsOk(s.prog, s.cfg, s.vars - LoopVars(s.tasks));
  }

  // ---- what a statement or loop step leaves: within B's Completes ----

  // An iteration binds the loop variable to its item.
  lemma BindOk(s: State)
    requires Idle(s) && s.tasks[0].op.Bind?
    ensures var op := s.tasks[0].op; var vars2 := s.vars[op.v := ItemSlot(op.item, op.list)];
      Models(vars2, AfterOp(s.prog, op, s.tasks[0].E)) && VarsOk(s.prog, s.cfg, vars2)
  {
    var op := s.tasks[0].op;
    assert TaskOk(s.prog, s.cfg, s.sec, s.tasks[0]);
    assert KindMap(s.vars[op.v := ItemSlot(op.item, op.list)]) == KindMap(s.vars)[op.v := ItemKind(op.item, op.list.id)];
  }

  // The loop is over: its variable is unbound.
  lemma UnbindOk(s: State)
    requires Idle(s) && s.tasks[0].op.Unbind?
    ensures var op := s.tasks[0].op; var vars2 := s.vars - {op.v};
      Models(vars2, AfterOp(s.prog, op, s.tasks[0].E)) && VarsOk(s.prog, s.cfg, vars2)
  {
    assert KindMap(s.vars - {s.tasks[0].op.v}) == KindMap(s.vars) - {s.tasks[0].op.v};
  }

  // A statement that binds nothing carries on with the variables as they are.
  lemma SameOk(s: State)
    requires Running(s) && s.tasks[0].op.S? && Binding(Stmt0(s)).None? && !Stmt0(s).ForEach? && !Terminal(Stmt0(s))
    ensures Models(s.vars, AfterOp(s.prog, s.tasks[0].op, s.tasks[0].E))
  {
    var p, t, c := s.prog, s.tasks[0], KindMap(s.vars);
    Ready(s);
    assert Completes(p, Stmt0(s), c, c);
    StmtSim(p, TheIn(p), Stmt0(s), t.E, t.lv, t.gov, c);
  }

  // A statement binds its name to sl.
  lemma BindingOk(s: State, sl: Slot)
    requires Running(s) && s.tasks[0].op.S? && Binding(Stmt0(s)).Some?
    requires sl.kind in BindKinds(Stmt0(s)) && SlotOk(s.prog, s.cfg, Binding(Stmt0(s)).value, sl)
    ensures var vars2 := s.vars[Binding(Stmt0(s)).value := sl];
      Models(vars2, AfterOp(s.prog, s.tasks[0].op, s.tasks[0].E)) && VarsOk(s.prog, s.cfg, vars2)
  {
    var p, t, st, x := s.prog, s.tasks[0], Stmt0(s), Binding(Stmt0(s)).value;
    Ready(s);
    var c, c' := KindMap(s.vars), KindMap(s.vars[x := sl]);
    assert c' == c[x := sl.kind];
    if st.Ask? && st.form.OneOf? { assert st.form.list in ListRefs(st); }
    assert Completes(p, st, c, c');
    StmtSim(p, TheIn(p), st, t.E, t.lv, t.gov, c);
  }

  // `run … as x · else skip` failed: x is left unbound (SPEC §4.3).
  lemma UnboundOk(s: State)
    requires Running(s) && s.tasks[0].op.S? && Stmt0(s).Run? && Stmt0(s).binding.Some? && Stmt0(s).els.Skip?
    ensures var vars2 := s.vars - {Stmt0(s).binding.value};
      Models(vars2, AfterOp(s.prog, s.tasks[0].op, s.tasks[0].E)) && VarsOk(s.prog, s.cfg, vars2)
  {
    var p, t, st := s.prog, s.tasks[0], Stmt0(s);
    var c, c' := KindMap(s.vars), KindMap(s.vars - {st.binding.value});
    assert c' == c - {st.binding.value};
    assert Completes(p, st, c, c');
    StmtSim(p, TheIn(p), st, t.E, t.lv, t.gov, c);
  }

  lemma RunSlotOk(s: State, sl: Slot)
    requires Running(s) && s.tasks[0].op.S? && Stmt0(s).Run? && Stmt0(s).binding.Some?
    requires sl.kind == KRun && sl.b.origin == FromRunOutput && sl.b.value.Str?
    ensures SlotOk(s.prog, s.cfg, Stmt0(s).binding.value, sl)
  {
    Ready(s);
  }

  lemma ValueSlotOk(s: State, l: SectionId, it: Item)
    requires IsData(s.prog, l) && it in DataList(s.prog, l).items && it.Value?
    ensures forall x :: SlotOk(s.prog, s.cfg, x, Slot(Bound(Str(it.value), FromListItem), None, KValue(l)))
  {}

  // `else skip` on an ask is only allowed on yes/no (SPEC §4.2).
  lemma AskOkIn(s: State)
    requires Running(s) && s.tasks[0].op.S? && Stmt0(s).Ask? && Stmt0(s).els.Skip?
    ensures Stmt0(s).form.YesNo?
  {
    Ready(s);
    assert AskOk(Stmt0(s));
  }

  // ---- unrolling a loop ----

  lemma ExpandOk(s: State)
    requires Idle(s) && s.tasks[0].op.S? && Stmt0(s).ForEach? && IsData(s.prog, Stmt0(s).list.id)
    ensures var s2 := s.(tasks := Expand(s.prog, s.tasks[0]) + s.tasks[1..]); Idle(s2) && Busy(s2) < Busy(s)
  {
    ExpandTasks(s.prog, s.cfg, s.sec, s.vars, s.tasks);
  }

  ghost predicate AllOk(p: Program, cfg: RunConfig, sec: SectionId, ts: seq<Task>) requires ProgOk(p, cfg) && IsInstr(p, sec) {
    forall k | 0 <= k < |ts| :: TaskOk(p, cfg, sec, ts[k])
  }

  lemma ExpandTasks(p: Program, cfg: RunConfig, sec: SectionId, vars: Vars, tasks: seq<Task>)
    requires ProgOk(p, cfg) && IsInstr(p, sec) && VarsOk(p, cfg, vars)
    requires |tasks| > 0 && Ends(tasks) && AllOk(p, cfg, sec, tasks) && Chain(p, tasks) && Scoped(tasks) && Models(vars, tasks[0].E)
    requires tasks[0].op.S? && tasks[0].op.stmt.ForEach? && IsData(p, tasks[0].op.stmt.list.id)
    ensures var ts := Expand(p, tasks[0]) + tasks[1..];
      |ts| > 0 && Ends(ts) && AllOk(p, cfg, sec, ts) && Chain(p, ts) && Scoped(ts) && Models(vars, ts[0].E)
      && Rem(p, ts) < Rem(p, tasks)
  {
    var t, fe := tasks[0], tasks[0].op.stmt;
    var E, v := t.E, fe.loopVar;
    var items := DataList(p, fe.list.id).items;
    assert TaskOk(p, cfg, sec, t);
    assert fe in Stmts(p);
    assert StmtOk(p, TheIn(p), fe, E, t.lv, t.gov);
    FlatNested(Body(p, sec), fe);
    FlatHas(fe.body);
    LoopEntryFirst(p, fe, E);
    IterFacts(p, cfg, sec, fe, items, E, E, t.lv);
    var its := Iters(p, fe, items, E, E, t.lv);
    var W := Walk(p, fe.body, LoopEntry(p, fe, E));
    var R := Task(Unbind(v, fe.src), None, W, {});
    var rest := tasks[1..];
    assert Expand(p, t) == its + [R];
    ChainJoin(p, its, [R]);
    if |rest| > 0 {
      // The loop's end is exactly what B's After says of the loop.
      assert AfterOp(p, R.op, R.E) == LoopExit(p, fe, E) == After(p, fe, E);
      assert Approx(rest[0].E, AfterOp(p, R.op, R.E)) by { assert rest[0] == tasks[1]; }
    }
    assert Chain(p, rest);
    ChainJoin(p, its + [R], rest);
    assert TaskOk(p, cfg, sec, R);
    AllOkJoin(p, cfg, sec, its, [R]);
    assert AllOk(p, cfg, sec, rest);
    AllOkJoin(p, cfg, sec, its + [R], rest);
    ExpandRem(p, fe, its, R, tasks);
    ExpandScoped(its, R, tasks, t.lv, v);
    ExpandEnds(p, fe, its, R, tasks);
    assert (its + [R] + rest)[0] == its[0];
  }

  // The first terminal statement is still ahead: in the first iteration
  // when the loop itself is terminal, or after the loop.
  lemma ExpandEnds(p: Program, fe: Stmt, its: seq<Task>, R: Task, tasks: seq<Task>)
    requires fe.ForEach? && |tasks| > 0 && tasks[0].op == S(fe) && Ends(tasks)
    requires Terminal(fe) ==> |its| > |fe.body| && forall k | 0 <= k < |fe.body| :: its[1 + k].op == S(fe.body[k])
    ensures Ends(its + [R] + tasks[1..])
  {
    var ts := its + [R] + tasks[1..];
    if Terminal(fe) {
      var k := |fe.body|;
      assert ts[k] == its[k] && its[k].op == S(fe.body[k - 1]);
    } else {
      var k :| 0 <= k < |tasks| && tasks[k].op.S? && Terminal(tasks[k].op.stmt);
      assert k > 0 && ts[|its| + k] == tasks[k];
    }
  }

  lemma ExpandScoped(its: seq<Task>, R: Task, tasks: seq<Task>, lv: set<Name>, v: Name)
    requires |tasks| > 0 && Scoped(tasks) && tasks[0].op.S? && tasks[0].lv == lv
    requires forall k | 0 <= k < |its| :: !its[k].op.Unbind? && (its[k].op.S? ==> its[k].lv == lv + {v})
    requires R.op.Unbind? && R.op.v == v
    ensures Scoped(its + [R] + tasks[1..])
  {
    var ts := its + [R] + tasks[1..];
    var rest := tasks[1..];
    assert tasks[0].lv == LoopVars(rest) by { assert tasks[0 + 1..] == rest; }
    assert LoopVars([R]) == {v} by { assert [R][0] == R; }
    forall j | 0 <= j < |ts| && ts[j].op.S? ensures ts[j].lv == LoopVars(ts[j + 1..]) {
      if j < |its| {
        assert ts[j] == its[j];
        assert ts[j + 1..] == its[j + 1..] + [R] + rest;
        LoopVarsSplit(its[j + 1..], [R]);
        LoopVarsSplit(its[j + 1..] + [R], rest);
        NoLoopVarsIn(its[j + 1..]);
      } else {
        assert ts[|its|] == R;
        var i := j - |its|;
        assert j > |its| && ts[j] == tasks[i] && ts[j + 1..] == tasks[i + 1..];
      }
    }
  }

  // Unrolling a loop lowers the remaining cost by one.
  lemma ExpandRem(p: Program, fe: Stmt, its: seq<Task>, R: Task, tasks: seq<Task>)
    requires fe.ForEach? && IsData(p, fe.list.id) && !R.op.S?
    requires |tasks| > 0 && tasks[0].op == S(fe)
    requires Rem(p, its) == |DataList(p, fe.list.id).items| * (1 + CostBody(p, fe.body))
    ensures Rem(p, its + [R] + tasks[1..]) < Rem(p, tasks)
  {
    RemJoin(p, its, [R]);
    RemJoin(p, its + [R], tasks[1..]);
    assert Rem(p, [R]) == 1;
    assert Rem(p, tasks) == OpCost(p, tasks[0].op) + Rem(p, tasks[1..]);
    assert CostBody(p, [fe][1..]) == 0;
  }

  // The unrolled iterations of a loop over items, the first binding from Eb.
  lemma IterFacts(p: Program, cfg: RunConfig, sec: SectionId, fe: Stmt, items: seq<Item>, Eb: Env, E: Env, lv: set<Name>)
    requires ProgOk(p, cfg) && IsInstr(p, sec) && fe.ForEach? && IsData(p, fe.list.id)
    requires forall it <- items :: it in DataList(p, fe.list.id).items
    requires SeqOk(p, TheIn(p), fe.body, LoopEntry(p, fe, E), lv + {fe.loopVar}, None)
    requires forall st <- fe.body :: st in Flat(Body(p, sec))
    requires Approx(LoopEntry(p, fe, E), Env(Eb.bound + {fe.loopVar}, Eb.kinds[fe.loopVar := ItemKinds(p, fe.list)]))
    ensures var ts := Iters(p, fe, items, Eb, E, lv); var W := Walk(p, fe.body, LoopEntry(p, fe, E));
      AllOk(p, cfg, sec, ts)
      && (forall k | 0 <= k < |ts| :: !ts[k].op.Unbind? && (ts[k].op.S? ==> ts[k].lv == lv + {fe.loopVar}))
      && Chain(p, ts)
      && (|items| > 0 ==> |ts| > |fe.body| && ts[0].E == Eb && forall k | 0 <= k < |fe.body| :: ts[1 + k].op == S(fe.body[k]))
      && (|items| > 0 ==> Approx(W, AfterOp(p, ts[|ts| - 1].op, ts[|ts| - 1].E)))
      && Rem(p, ts) == |items| * (1 + CostBody(p, fe.body))
  {
    IterOps(p, fe, items, Eb, E, lv);
    IterChain(p, fe, items, Eb, E, lv);
    IterRem(p, fe, items, Eb, E, lv);
    IterTyped(p, cfg, sec, fe, items, Eb, E, lv);
  }

  lemma IterOps(p: Program, fe: Stmt, items: seq<Item>, Eb: Env, E: Env, lv: set<Name>)
    requires fe.ForEach?
    ensures var ts := Iters(p, fe, items, Eb, E, lv);
      (forall k | 0 <= k < |ts| :: !ts[k].op.Unbind? && (ts[k].op.S? ==> ts[k].lv == lv + {fe.loopVar}))
      && (|items| > 0 ==> |ts| > |fe.body| && ts[0].E == Eb && forall k | 0 <= k < |fe.body| :: ts[1 + k].op == S(fe.body[k]))
    decreases |items|
  {
    if |items| > 0 {
      var T := Tasks(p, fe.body, None, LoopEntry(p, fe, E), lv + {fe.loopVar});
      var W := Walk(p, fe.body, LoopEntry(p, fe, E));
      var more := Iters(p, fe, items[1..], W, E, lv);
      IterOps(p, fe, items[1..], W, E, lv);
      TasksShape(p, fe.body, None, LoopEntry(p, fe, E), lv + {fe.loopVar});
      var ts := Iters(p, fe, items, Eb, E, lv);
      assert ts == [ts[0]] + T + more;
      forall k | 0 <= k < |ts| ensures !ts[k].op.Unbind? && (ts[k].op.S? ==> ts[k].lv == lv + {fe.loopVar}) {
        if k == 0 {} else if k <= |T| { assert ts[k] == T[k - 1]; } else { assert ts[k] == more[k - 1 - |T|]; }
      }
      forall k | 0 <= k < |fe.body| ensures ts[1 + k].op == S(fe.body[k]) { assert ts[1 + k] == T[k]; }
    }
  }

  lemma IterChain(p: Program, fe: Stmt, items: seq<Item>, Eb: Env, E: Env, lv: set<Name>)
    requires fe.ForEach?
    requires Approx(LoopEntry(p, fe, E), Env(Eb.bound + {fe.loopVar}, Eb.kinds[fe.loopVar := ItemKinds(p, fe.list)]))
    ensures var ts := Iters(p, fe, items, Eb, E, lv); var W := Walk(p, fe.body, LoopEntry(p, fe, E));
      Chain(p, ts) && (|items| > 0 ==> |ts| > 0 && Approx(W, AfterOp(p, ts[|ts| - 1].op, ts[|ts| - 1].E)))
    decreases |items|
  {
    if |items| > 0 {
      var en := LoopEntry(p, fe, E);
      var W := Walk(p, fe.body, en);
      var B := Task(Bind(fe.loopVar, items[0], fe.src, fe.list), None, Eb, {});
      var T := Tasks(p, fe.body, None, en, lv + {fe.loopVar});
      var more := Iters(p, fe, items[1..], W, E, lv);
      LoopEntryAgain(p, fe, E);
      IterChain(p, fe, items[1..], W, E, lv);
      IterOps(p, fe, items[1..], W, E, lv);
      TasksShape(p, fe.body, None, en, lv + {fe.loopVar});
      ChainJoin(p, [B], T);
      var bt := [B] + T;
      // After an iteration's last step: W, or LoopEntry itself for an empty body.
      assert Approx(W, AfterOp(p, bt[|bt| - 1].op, bt[|bt| - 1].E)) by {
        if |T| > 0 { assert bt[|bt| - 1] == T[|T| - 1]; }
      }
      ChainJoin(p, bt, more);
      assert Iters(p, fe, items, Eb, E, lv) == bt + more;
      if |more| > 0 { assert (bt + more)[|bt + more| - 1] == more[|more| - 1]; }
      else { assert (bt + more)[|bt + more| - 1] == bt[|bt| - 1]; }
    }
  }

  lemma IterRem(p: Program, fe: Stmt, items: seq<Item>, Eb: Env, E: Env, lv: set<Name>)
    requires fe.ForEach?
    ensures Rem(p, Iters(p, fe, items, Eb, E, lv)) == |items| * (1 + CostBody(p, fe.body))
    decreases |items|
  {
    if |items| > 0 {
      var W := Walk(p, fe.body, LoopEntry(p, fe, E));
      var B := Task(Bind(fe.loopVar, items[0], fe.src, fe.list), None, Eb, {});
      var T := Tasks(p, fe.body, None, LoopEntry(p, fe, E), lv + {fe.loopVar});
      var more := Iters(p, fe, items[1..], W, E, lv);
      IterRem(p, fe, items[1..], W, E, lv);
      TasksShape(p, fe.body, None, LoopEntry(p, fe, E), lv + {fe.loopVar});
      assert Iters(p, fe, items, Eb, E, lv) == [B] + T + more;
      RemJoin(p, [B], T);
      RemJoin(p, [B] + T, more);
      assert Rem(p, [B]) == 1;
      Distr(|items|, 1 + CostBody(p, fe.body));
    }
  }

  lemma IterTyped(p: Program, cfg: RunConfig, sec: SectionId, fe: Stmt, items: seq<Item>, Eb: Env, E: Env, lv: set<Name>)
    requires ProgOk(p, cfg) && IsInstr(p, sec) && fe.ForEach? && IsData(p, fe.list.id)
    requires forall it <- items :: it in DataList(p, fe.list.id).items
    requires SeqOk(p, TheIn(p), fe.body, LoopEntry(p, fe, E), lv + {fe.loopVar}, None)
    requires forall st <- fe.body :: st in Flat(Body(p, sec))
    ensures AllOk(p, cfg, sec, Iters(p, fe, items, Eb, E, lv))
    decreases |items|
  {
    if |items| > 0 {
      var W := Walk(p, fe.body, LoopEntry(p, fe, E));
      var B := Task(Bind(fe.loopVar, items[0], fe.src, fe.list), None, Eb, {});
      var T := Tasks(p, fe.body, None, LoopEntry(p, fe, E), lv + {fe.loopVar});
      IterTyped(p, cfg, sec, fe, items[1..], W, E, lv);
      TasksTyped(p, cfg, sec, fe.body, None, LoopEntry(p, fe, E), lv + {fe.loopVar});
      assert TaskOk(p, cfg, sec, B);
      AllOkJoin(p, cfg, sec, [B], T);
      AllOkJoin(p, cfg, sec, [B] + T, Iters(p, fe, items[1..], W, E, lv));
      assert Iters(p, fe, items, Eb, E, lv) == [B] + T + Iters(p, fe, items[1..], W, E, lv);
    }
  }

  lemma Distr(n: nat, c: nat) requires n > 0 ensures n * c == c + (n - 1) * c {}

  // ---- sequences of tasks ----

  lemma ChainJoin(p: Program, a: seq<Task>, b: seq<Task>)
    requires Chain(p, a) && Chain(p, b)
    requires |a| > 0 && |b| > 0 ==> Approx(b[0].E, AfterOp(p, a[|a| - 1].op, a[|a| - 1].E))
    ensures Chain(p, a + b)
  {
    var ab := a + b;
    forall k | 0 <= k < |ab| - 1 ensures Approx(ab[k + 1].E, AfterOp(p, ab[k].op, ab[k].E)) {
      if k < |a| - 1 { assert ab[k] == a[k] && ab[k + 1] == a[k + 1]; }
      else if k == |a| - 1 { assert ab[k] == a[k] && ab[k + 1] == b[0]; }
      else { assert ab[k] == b[k - |a|] && ab[k + 1] == b[k + 1 - |a|]; }
    }
  }

  lemma RemJoin(p: Program, a: seq<Task>, b: seq<Task>)
    ensures Rem(p, a + b) == Rem(p, a) + Rem(p, b)
  {
    if |a| > 0 { assert (a + b)[1..] == a[1..] + b; RemJoin(p, a[1..], b); }
    else { assert a + b == b; }
  }

  lemma AllOkJoin(p: Program, cfg: RunConfig, sec: SectionId, a: seq<Task>, b: seq<Task>)
    requires ProgOk(p, cfg) && IsInstr(p, sec) && AllOk(p, cfg, sec, a) && AllOk(p, cfg, sec, b)
    ensures AllOk(p, cfg, sec, a + b)
  {
    forall k | 0 <= k < |a + b| ensures TaskOk(p, cfg, sec, (a + b)[k]) {
      if k < |a| { assert (a + b)[k] == a[k]; } else { assert (a + b)[k] == b[k - |a|]; }
    }
  }

  lemma LoopVarsSplit(a: seq<Task>, b: seq<Task>) ensures LoopVars(a + b) == LoopVars(a) + LoopVars(b) {
    var ab := a + b;
    forall x | x in LoopVars(ab) ensures x in LoopVars(a) + LoopVars(b) {
      var k :| 0 <= k < |ab| && ab[k].op.Unbind? && ab[k].op.v == x;
      if k < |a| { assert a[k] == ab[k]; } else { assert b[k - |a|] == ab[k]; }
    }
    forall x | x in LoopVars(a) + LoopVars(b) ensures x in LoopVars(ab) {
      if x in LoopVars(a) { var k :| 0 <= k < |a| && a[k].op.Unbind? && a[k].op.v == x; assert ab[k] == a[k]; }
      else { var k :| 0 <= k < |b| && b[k].op.Unbind? && b[k].op.v == x; assert ab[|a| + k] == b[k]; }
    }
  }

  lemma NoLoopVarsIn(ts: seq<Task>) requires forall k | 0 <= k < |ts| :: !ts[k].op.Unbind? ensures LoopVars(ts) == {} {}

  // A section's tasks have no loop in scope.
  lemma NoLoopVars(ts: seq<Task>)
    requires forall k | 0 <= k < |ts| :: ts[k].op.S? && ts[k].lv == {}
    ensures Scoped(ts)
  {
    forall j | 0 <= j < |ts| && ts[j].op.S? ensures ts[j].lv == LoopVars(ts[j + 1..]) { NoLoopVarsIn(ts[j + 1..]); }
  }

  // ---- helpers ----

  lemma FlatHas(b: seq<Stmt>) ensures forall st <- b :: st in Flat(b) {
    if |b| > 0 { FlatHas(b[1..]); }
  }

  // A loop body's statements are statements of the enclosing body.
  lemma FlatNested(B: seq<Stmt>, st: Stmt)
    requires st in Flat(B) && st.ForEach?
    ensures forall x <- Flat(st.body) :: x in Flat(B)
    decreases B
  {
    if |B| > 0 {
      assert Flat(B) == [B[0]] + (if B[0].ForEach? then Flat(B[0].body) else []) + Flat(B[1..]);
      if st in Flat(B[1..]) { FlatNested(B[1..], st); }
      else if st != B[0] { FlatNested(B[0].body, st); }
    }
  }

  lemma SumWRemove(p: Program, xs: set<SectionId>, y: SectionId)
    requires forall x <- xs :: IsInstr(p, x)
    requires y in xs
    ensures SumW(p, xs) == Weight(p, y) + SumW(p, xs - {y})
    decreases xs
  {
    var x :| x in xs && SumW(p, xs) == Weight(p, x) + SumW(p, xs - {x});
    if x != y {
      SumWRemove(p, xs - {x}, y);
      SumWRemove(p, xs - {y}, x);
      assert xs - {x} - {y} == xs - {y} - {x};
    }
  }

  lemma SumWMono(p: Program, xs: set<SectionId>, ys: set<SectionId>)
    requires forall x <- ys :: IsInstr(p, x)
    requires xs <= ys
    ensures SumW(p, xs) <= SumW(p, ys)
    decreases ys
  {
    if xs != {} {
      var y :| y in xs;
      SumWRemove(p, xs, y);
      SumWRemove(p, ys, y);
      SumWMono(p, xs - {y}, ys - {y});
    }
  }

  // A section and everything below it weigh no more than any set they're in.
  lemma BelowSum(p: Program, id: SectionId, ys: set<SectionId>)
    requires WellFormed(p) && IsInstr(p, id)
    requires forall x <- ys :: IsInstr(p, x)
    requires Below(p, id) + {id} <= ys
    ensures SumW(p, Below(p, id)) + Weight(p, id) <= SumW(p, ys)
  {
    var r := TheRank(p);
    assert id !in Below(p, id);
    SumWRemove(p, Below(p, id) + {id}, id);
    assert Below(p, id) + {id} - {id} == Below(p, id);
    SumWMono(p, Below(p, id) + {id}, ys);
  }

  // A body's statements as tasks: chained, and costing what the body does.
  lemma TasksShape(p: Program, b: seq<Stmt>, gov: Option<Name>, E: Env, lv: set<Name>)
    ensures var ts := Tasks(p, b, gov, E, lv);
      |ts| == |b|
      && (forall k | 0 <= k < |ts| :: ts[k].op == S(b[k]) && ts[k].lv == lv)
      && Chain(p, ts)
      && (|b| > 0 ==> ts[0].E == E && AfterOp(p, ts[|ts| - 1].op, ts[|ts| - 1].E) == Walk(p, b, E))
      && Rem(p, ts) == CostBody(p, b)
    decreases b
  {
    if |b| > 0 {
      var rest := Tasks(p, b[1..], NextGov(b[0], gov), After(p, b[0], E), lv);
      TasksShape(p, b[1..], NextGov(b[0], gov), After(p, b[0], E), lv);
      var ts := Tasks(p, b, gov, E, lv);
      assert ts == [Task(S(b[0]), gov, E, lv)] + rest;
      assert [b[0]][1..] == [];
      assert CostBody(p, [b[0]][1..]) == 0;
      assert Rem(p, ts) == OpCost(p, S(b[0])) + Rem(p, rest);
    }
  }

  lemma TasksTyped(p: Program, cfg: RunConfig, sec: SectionId, b: seq<Stmt>, gov: Option<Name>, E: Env, lv: set<Name>)
    requires ProgOk(p, cfg) && IsInstr(p, sec)
    requires SeqOk(p, TheIn(p), b, E, lv, gov)
    requires forall st <- b :: st in Flat(Body(p, sec))
    ensures AllOk(p, cfg, sec, Tasks(p, b, gov, E, lv))
    decreases b
  {
    if |b| > 0 {
      TasksTyped(p, cfg, sec, b[1..], NextGov(b[0], gov), After(p, b[0], E), lv);
      var rest := Tasks(p, b[1..], NextGov(b[0], gov), After(p, b[0], E), lv);
      assert TaskOk(p, cfg, sec, Task(S(b[0]), gov, E, lv));
      AllOkJoin(p, cfg, sec, [Task(S(b[0]), gov, E, lv)], rest);
    }
  }

  lemma OptionsLen(p: Program, form: AskForm)
    requires FormOk(p, form)
    ensures |Options(p, form)| == match form
      case Sections(opts) => |opts|
      case YesNo(_) => 2
      case OneOf(l, _) => |DataList(p, l.id).items|
  {}

  // ---- P3, P4 for each request ----

  lemma IssueNextOk(s: State)
    requires Running(s) && Issues(s)
    ensures NextOk(s.prog, s.cfg, IssueNext(s))
  {
    var p, cfg, st, n := s.prog, s.cfg, Stmt0(s), IssueNext(s);
    Ready(s);
    match st
    case Run(_, c, _, _) => CmdOk(s, c); assert TemplateOf(st, RunExec) == Some(c);
    case IfYesRun(_, c, _) => CmdOk(s, c); assert TemplateOf(st, RunExec) == Some(c);
    case Check(_, cond, _, _) =>
      if cond.Succeeds? { CmdOk(s, cond.cmd); assert TemplateOf(st, CheckExec) == Some(cond.cmd); }
    case Do(_, a, _) => DoOk(s, a);
    case IfYesDo(_, a, _) => DoOk(s, a);
    case Ask(_, q, _, form, _) =>
      QuestionOk(p, cfg, s.runNames, s.vars, q);
      ContextOk(p, cfg, s.vars, q);
      assert AskReqOk(p, cfg, n.request) by {
        assert st in Stmts(p) && st.Ask?;
        assert n.request.question == Concat(QPieces(s.runNames, s.vars, q));
      }
    case Page(_, _) =>
  }

  // A value that may go in a command.
  ghost predicate CmdSafe(p: Program, cfg: RunConfig, sl: Slot) {
    sl.b.origin != FromRunOutput && SafeValue(Show(sl.b.value)) && TrustedValue(p, cfg, Show(sl.b.value))
  }

  // A name B's SafeAt allows in a command holds a trusted, safe value (P4).
  lemma CmdVarSafe(p: Program, cfg: RunConfig, vars: Vars, x: Name)
    requires ProgOk(p, cfg) && VarsOk(p, cfg, vars) && InCmd(p, KindMap(vars), x) && x in CmdNames(p)
    ensures x in vars && CmdSafe(p, cfg, vars[x])
  {
    var sl := vars[x];
    assert SlotOk(p, cfg, x, sl);
    match sl.kind
    case KValue(l) =>
      var it :| it in DataList(p, l).items && it.Value? && sl.b.value == Str(it.value);
      assert Label(it) == it.value;
    case _ =>
  }

  lemma PiecesOk(p: Program, cfg: RunConfig, vars: Vars, c: Parts)
    requires forall pt <- c :: pt.Var? ==> pt.name in vars && CmdSafe(p, cfg, vars[pt.name])
    ensures CmdBound(vars, c) && RenderCmd(vars, c) == Concat(CmdPieces(vars, c)) && PiecesMatch(p, cfg, c, CmdPieces(vars, c))
  {
    if |c| > 0 { PiecesOk(p, cfg, vars, c[1..]); }
  }

  lemma CmdOk(s: State, c: Parts)
    requires Running(s) && s.tasks[0].op.S? && PartVars(c) <= CmdVars(Stmt0(s))
    ensures CmdBound(s.vars, c) && RenderCmd(s.vars, c) == Concat(CmdPieces(s.vars, c))
    ensures PiecesMatch(s.prog, s.cfg, c, CmdPieces(s.vars, c))
  {
    Ready(s);
    forall pt <- c | pt.Var? ensures pt.name in s.vars && CmdSafe(s.prog, s.cfg, s.vars[pt.name]) {
      assert pt.name in PartVars(c);
      assert pt.name in CmdNames(s.prog);
      CmdVarSafe(s.prog, s.cfg, s.vars, pt.name);
    }
    PiecesOk(s.prog, s.cfg, s.vars, c);
  }

  lemma DoOk(s: State, a: DoBody)
    requires Running(s) && s.tasks[0].op.S? && (Stmt0(s).Do? || Stmt0(s).IfYesDo?) && Stmt0(s).action == a
    ensures DoReady(s.vars, a) && CmdBound(s.vars, DoParts(s.vars, a))
    ensures var c := DoParts(s.vars, a);
      RenderCmd(s.vars, c) == Concat(CmdPieces(s.vars, c)) && FromTemplate(s.prog, s.cfg, DoExec, CmdPieces(s.vars, c))
  {
    Ready(s);
    var p, st := s.prog, Stmt0(s);
    match a
    case DoCmd(c) => CmdOk(s, c); assert TemplateOf(st, DoExec) == Some(c);
    case DoItem(x) =>
      assert x in DoItems(st);
      var sl := s.vars[x];
      assert SlotOk(p, s.cfg, x, sl);
      var l := sl.kind.list;
      var it := sl.item.value;
      // An action item's command names only what B's SafeAt allows (P4).
      forall pt <- it.cmd | pt.Var? ensures pt.name in s.vars && CmdSafe(p, s.cfg, s.vars[pt.name]) {
        assert it in DataList(p, l).items && pt.name in PartVars(it.cmd);
        assert pt.name in ActionVars(p, l);
        assert pt.name in CmdNames(p);
        CmdVarSafe(p, s.cfg, s.vars, pt.name);
      }
      PiecesOk(p, s.cfg, s.vars, it.cmd);
      assert ActionCmd(p, it.cmd);
  }

  // A value that isn't run output is trusted.
  lemma SlotTrusted(p: Program, cfg: RunConfig, x: Name, sl: Slot)
    requires WellFormed(p) && SlotOk(p, cfg, x, sl) && sl.b.origin != FromRunOutput
    ensures TrustedValue(p, cfg, Show(sl.b.value))
  {
    match sl.kind
    case KValue(l) => var it :| it in DataList(p, l).items && it.Value? && sl.b.value == Str(it.value); assert Label(it) == it.value;
    case KAction(l) => var it := sl.item.value; assert Label(it) == it.text;
    case _ =>
  }

  // A question: author text, trusted values, and run output only by name (P4).
  lemma QuestionOk(p: Program, cfg: RunConfig, rn: set<Name>, vars: Vars, q: Parts)
    requires WellFormed(p) && VarsOk(p, cfg, vars)
    ensures RenderQ(rn, vars, q) == Concat(QPieces(rn, vars, q)) && QPiecesMatch(p, cfg, q, QPieces(rn, vars, q))
  {
    if |q| > 0 {
      QuestionOk(p, cfg, rn, vars, q[1..]);
      if q[0].Var? && q[0].name in vars && vars[q[0].name].b.origin != FromRunOutput {
        SlotTrusted(p, cfg, q[0].name, vars[q[0].name]);
      }
    }
  }

  // The context holds only names the question uses that can hold run output (SPEC §6.3).
  lemma ContextOk(p: Program, cfg: RunConfig, vars: Vars, q: Parts)
    requires VarsOk(p, cfg, vars)
    ensures forall x | x in Context(RunNames(p), vars, q) :: x in PartVars(q) && x in RunNames(p)
  {
    forall x | x in Context(RunNames(p), vars, q) ensures x in PartVars(q) && x in RunNames(p) {
      if x in vars { assert SlotOk(p, cfg, x, vars[x]); }
    }
  }
}
