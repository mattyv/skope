// The interpreter (SPEC §4, §5.2): Start and Step. Pure; the host performs
// each request Step returns and feeds the result back.
//
// Every helper promises Post: the invariant still holds, the log grew by
// exactly the events returned, the measure fell below the given bound
// unless the run ended (P1), and the request is one the program allows
// (P3, P4). Proofs.dfy lifts these to whole runs.
module SkopeRun {
  import opened SkopeAst
  import opened SkopeStep
  import opened SkopeWellFormed
  import opened SkopeValues
  import opened SkopeState
  import opened SkopeLemmas

  // Start requires what lint guarantees (WellFormed, P6) plus the host's checks.
  function Start(p: Program, cfg: RunConfig): (s: State)
    requires ProgOk(p, cfg)
    ensures Inv(s) && s.last.None? && s.prog == p && s.cfg == cfg && s.log == []
    ensures Measure(s) < StepBound(p)
  {
    StartOk(p, cfg);
    StartState(p, cfg)
  }

  // ---- plumbing ----

  ghost predicate Post(s: State, res: (State, seq<CoreEvent>, Next), m: nat) {
    var (s2, evs, n) := res;
    Inv(s2) && s2.prog == s.prog && s2.cfg == s.cfg && s2.log == s.log + evs && s2.last == Some(n)
    && (!n.Done? ==> Measure(s2) < m)
    && NextOk(s.prog, s.cfg, n)
  }

  function Ev(s: State, body: EventBody): CoreEvent requires IsInstr(s.prog, s.sec) && |s.tasks| > 0 {
    CoreEvent(Some(Where(s.prog.sections[s.sec].name, OpSrc(s.tasks[0].op))), body)
  }
  function Log(s: State, e: CoreEvent): (s2: State)
    requires Idle(s) && Plain(s, e)
    ensures s2 == s.(log := s.log + [e]) && Idle(s2)
  {
    LoggedOk(s, s.(log := s.log + [e]), e);
    s.(log := s.log + [e])
  }
  function Then(e: CoreEvent, r: (State, seq<CoreEvent>, Next)): (State, seq<CoreEvent>, Next) { (r.0, [e] + r.1, r.2) }

  // ---- ending, moving on, transferring ----

  function Finish(s: State, o: Outcome): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s)
    ensures Post(s, res, 0) && res.2 == Done(o)
  {
    var e := Ev(s, OutcomeEv(o, s.askCalls, s.effects, s.cfg.dry));
    FinishOk(s, s.(last := Some(Done(o)), log := s.log + [e]), e);
    (s.(last := Some(Done(o)), log := s.log + [e]), [e], Done(o))
  }

  // The first task carried on, leaving vars2.
  function Continue(s: State, vars2: Vars): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && !(s.tasks[0].op.S? && Terminal(s.tasks[0].op.stmt))
    requires Models(vars2, AfterOp(s.prog, s.tasks[0].op, s.tasks[0].E)) && VarsOk(s.prog, s.cfg, vars2)
    ensures Post(s, res, Busy(s))
    decreases Busy(s), 2
  {
    ContinueOk(s, vars2);
    Advance(s.(tasks := s.tasks[1..], vars := vars2))
  }

  // A transfer (SPEC §4.1): control moves to j's section and never returns.
  function Goto(s: State, j: Jump): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && s.tasks[0].op.S? && j in Jumps(Stmt0(s))
    ensures Post(s, res, Base(s))
    decreases Base(s), 0
  {
    JumpOk(s, j);
    var p, id := s.prog, j.ref.id;
    var e := Ev(s, TransferEv(p.sections[s.sec].name, p.sections[id].name));
    EnterOk(s, id, e);
    Then(e, Advance(Enter(s, id, e)))
  }

  // ---- running forward ----

  // Runs the first task and on until something needs the host, or the run ends.
  function Advance(s: State): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s)
    ensures Post(s, res, Busy(s) + 1)
    decreases Busy(s) + 1, 1
  {
    var p, t := s.prog, s.tasks[0];
    Ready(s);
    match t.op
    case Bind(v, it, _, l) => BindOk(s); Continue(s, s.vars[v := ItemSlot(it, l)])
    case Unbind(v, _) => UnbindOk(s); Continue(s, s.vars - {v})
    case S(st) =>
      if Issues(s) then Issue(s)
      else
        match st
        case Stop(_) => Finish(s, Stopped)
        case HandOff(_) => Finish(s, Handoff(Explicit, None))
        case Then(src, r) => Goto(s, Jump(r, src))
        case ForEach(_, _, _, _) =>
          ExpandOk(s);
          Advance(s.(tasks := Expand(p, t) + s.tasks[1..]))
        case Page(_, text) =>
          var e := Ev(s, WouldPageEv(RenderText(s.vars, text)));
          Then(e, Finish(Log(s, e), Paged))
        case Do(_, a, _) => WouldDo(s, a)
        case IfYesDo(_, a, _) => if Yes(s.vars, t.gov) then WouldDo(s, a) else SameOk(s); Continue(s, s.vars)
        case IfYesRun(_, _, _) => SameOk(s); Continue(s, s.vars)
        case Check(_, cond, _, _) => Compare(s, cond)
        case _ => assert false; Finish(s, Stopped)
  }

  // Hand the first task's request to the host.
  function Issue(s: State): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && Issues(s)
    ensures Post(s, res, Busy(s) + 1)
  {
    var n := IssueNext(s);
    IssueNextOk(s);
    if Stmt0(s).Do? || Stmt0(s).IfYesDo? then
      var e := Ev(s, EffectStartEv(n.cmd));
      IssueOk(s, s.(log := s.log + [e], effects := s.effects + 1, last := Some(n)), [e]);
      (s.(log := s.log + [e], effects := s.effects + 1, last := Some(n)), [e], n)
    else
      IssueOk(s, s.(last := Some(n)), []);
      (s.(last := Some(n)), [], n)
  }

  // Dry run (SPEC §4.5): the `do` isn't run; log would_do and carry on.
  function WouldDo(s: State, a: DoBody): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && s.cfg.dry && s.tasks[0].op.S? && (Stmt0(s).Do? || Stmt0(s).IfYesDo?) && Stmt0(s).action == a
    ensures Post(s, res, Busy(s) + 1)
    decreases Busy(s) + 1, 0
  {
    Ready(s);
    var e := Ev(s, WouldDoEv(RenderCmd(s.vars, DoParts(s.vars, a))));
    var s1 := s.(log := s.log + [e], afterWouldDo := true);
    WouldDoLogOk(s, s1, e);
    SameOk(s1);
    Then(e, Continue(s1, s.vars))
  }

  function OperandVal(vars: Vars, o: Operand): Val requires o.VarOp? ==> o.name in vars {
    match o case VarOp(x) => vars[x].b.value case Num(t) => Str(t)
  }
  function OperandText(o: Operand): string { match o case VarOp(x) => "{" + x + "}" case Num(t) => t }
  function OpText(op: CmpOp): string {
    match op case Lt => "<" case Le => "<=" case Gt => ">" case Ge => ">=" case Eq => "==" case Ne => "!="
  }
  function Expr(c: Cond): string requires c.Cmp? { OperandText(c.l) + " " + OpText(c.op) + " " + OperandText(c.r) }

  // A comparison on known values (SPEC §4.2): coerce both, compare.
  function Compare(s: State, c: Cond): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && s.tasks[0].op.S? && Stmt0(s).Check? && Stmt0(s).cond == c && c.Cmp?
    ensures Post(s, res, Busy(s) + 1)
    decreases Busy(s) + 1, 0
  {
    Ready(s);
    var l, r := OperandVal(s.vars, c.l), OperandVal(s.vars, c.r);
    var a, b := Coerce(l), Coerce(r);
    var result := if a.Some? && b.Some? then Some(SkopeValues.Compare(c.op, a.value, b.value)) else None;
    AfterCheck(s, Ev(s, CheckEv(Expr(c), NumText(l), NumText(r), result, s.afterWouldDo)), result, Some(CmpDetail(c, l, r)))
  }

  // A check came out true, false, or (None) failed; e logs it.
  function AfterCheck(s: State, e: CoreEvent, result: Option<bool>, detail: Option<string>): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && s.tasks[0].op.S? && Stmt0(s).Check? && Plain(s, e)
    ensures Post(s, res, Busy(s))
    decreases Busy(s), 4
  {
    Then(e, if result.None? then Failed(Log(s, e), detail) else CheckDone(Log(s, e), result.value))
  }

  // Failure handling for run, do and check (SPEC §4.3).
  // A comparison that couldn't coerce, for the handoff record (SPEC §8.1):
  // {"expr", "left", "right"} as JSON, with the operands as they were.
  function CmpDetail(c: Cond, l: Val, r: Val): string requires c.Cmp? {
    "{\"expr\":" + Json(Expr(c)) + ",\"left\":" + Json(Show(l)) + ",\"right\":" + Json(Show(r)) + "}"
  }

  // `detail` is Some for a comparison that couldn't coerce (CmpDetail).
  function Failed(s: State, detail: Option<string>): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && s.tasks[0].op.S?
    requires Stmt0(s).Run? || Stmt0(s).Do? || Stmt0(s).Check? || Stmt0(s).IfYesRun? || Stmt0(s).IfYesDo?
    ensures Post(s, res, Busy(s))
    decreases Busy(s), 3
  {
    var st := Stmt0(s);
    match st.els
    case NoElse => Finish(s, Handoff(CommandFailed, detail))
    case Skip =>
      if st.Run? && st.binding.Some? then UnboundOk(s); Continue(s, s.vars - {st.binding.value})
      else SameOk(s); Continue(s, s.vars)
    case ElseTo(r) => Goto(s, Jump(r, st.src))
  }

  // A check came out true or false (SPEC §4.2).
  function CheckDone(s: State, b: bool): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && s.tasks[0].op.S? && Stmt0(s).Check?
    ensures Post(s, res, Busy(s))
    decreases Busy(s), 3
  {
    var st := Stmt0(s);
    if b then
      match st.onTrue
      case None => SameOk(s); Continue(s, s.vars)
      case Some(StopTarget) => Finish(s, Stopped)
      case Some(To(r)) => Goto(s, Jump(r, st.src))
    else if st.els.ElseTo? then Goto(s, Jump(st.els.ref, st.src))
    else SameOk(s); Continue(s, s.vars)
  }

  // ---- answers ----

  function Ok(r: Response): bool requires r.ExecResult? { r.exit == Some(0) && !r.timedOut }

  function RunSlot(stdout: string): Slot { Slot(Bound(Str(Trim(stdout)), FromRunOutput), None, KRun) }

  function ChosenOf(form: AskForm, ids: seq<string>, c: nat): Chosen requires c < |ids| { ChosenId(ids[c]) }
  function FailureText(f: AskFailure): string { match f case Unavailable => "unavailable" case RequestTooLarge => "request_too_large" }

  // The gate failed (SPEC §4.2).
  function GateMiss(s: State): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && s.tasks[0].op.S? && Stmt0(s).Ask?
    ensures Post(s, res, Busy(s))
  {
    var st := Stmt0(s);
    Ready(s);
    match st.els
    case NoElse => Finish(s, Handoff(GateFailed, None))
    case Skip =>
      AskOkIn(s);
      var sl := Slot(Bound(Str("no"), FromYesNo), None, KYesNo);
      BindingOk(s, sl);
      Continue(s, s.vars[st.form.binding := sl])
    case ElseTo(r) => Goto(s, Jump(r, st.src))
  }

  // The gate passed on option c (P5: only ever one of the author's options).
  function Accept(s: State, c: nat): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && s.tasks[0].op.S? && Stmt0(s).Ask?
    requires FormOk(s.prog, Stmt0(s).form) && c < |Options(s.prog, Stmt0(s).form)|
    ensures Post(s, res, Busy(s))
  {
    var st, p := Stmt0(s), s.prog;
    Ready(s);
    OptionsLen(p, st.form);
    match st.form
    case Sections(opts) => assert Jump(opts[c].ref, opts[c].src) in Jumps(st); Goto(s, Jump(opts[c].ref, opts[c].src))
    case YesNo(x) =>
      var sl := Slot(Bound(Str(if c == 0 then "yes" else "no"), FromYesNo), None, KYesNo);
      BindingOk(s, sl);
      Continue(s, s.vars[x := sl])
    case OneOf(l, x) =>
      var it := DataList(p, l.id).items[c];
      var sl := Slot(Bound(Str(it.value), FromListItem), None, KValue(l.id));
      ValueSlotOk(s, l.id, it);
      BindingOk(s, sl);
      Continue(s, s.vars[x := sl])
  }

  function Answered(s: State, st: Stmt, req: AskRequest, r: Response): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && s.tasks[0].op.S? && Stmt0(s) == st && st.Ask? && r.AskAnswer?
    requires FormOk(s.prog, st.form) && req.options == Options(s.prog, st.form)
    ensures Post(s, res, Busy(s))
  {
    var ids := Ids(req.options);
    var v := Gate(ids, r.probs, r.unassigned, st.sure);
    GateSound(ids, r.probs, r.unassigned, st.sure);
    match v
    case Invalid =>
      var e := Ev(s, AskEv(req.question, req.kind, None, None, None, st.sure, false, Some(Unavailable), s.afterWouldDo));
      Then(e, Finish(Log(s, e), Handoff(AskUnavailable, Some(FailureText(Unavailable)))))
    case Unsure(c, conf) => GateMissed(s, st, req, r, c, conf)
    case Sure(c, conf) => GatePassed(s, st, req, r, c, conf)
  }

  function GateMissed(s: State, st: Stmt, req: AskRequest, r: Response, c: nat, conf: real): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && s.tasks[0].op.S? && Stmt0(s) == st && st.Ask? && r.AskAnswer? && c < |req.options|
    ensures Post(s, res, Busy(s))
  {
    var e := Ev(s, AskEv(req.question, req.kind, Some(r.probs), Some(ChosenOf(st.form, Ids(req.options), c)), Some(conf), st.sure, false, None, s.afterWouldDo));
    Then(e, GateMiss(Log(s, e)))
  }

  function GatePassed(s: State, st: Stmt, req: AskRequest, r: Response, c: nat, conf: real): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && s.tasks[0].op.S? && Stmt0(s) == st && st.Ask? && r.AskAnswer?
    requires FormOk(s.prog, st.form) && req.options == Options(s.prog, st.form) && c < |req.options|
    ensures Post(s, res, Busy(s))
  {
    var e := Ev(s, AskEv(req.question, req.kind, Some(r.probs), Some(ChosenOf(st.form, Ids(req.options), c)), Some(conf), st.sure, true, None, s.afterWouldDo));
    Then(e, Accept(Log(s, e), c))
  }

  // The host answered the pending request.
  function Resume(s: State, r: Response): (res: (State, seq<CoreEvent>, Next))
    requires Inv(s) && Pending(s) && Answers(s.last.value, r) && !r.DeadlineExceeded?
    ensures Post(s, res, Measure(s))
  {
    var n, st := s.last.value, Stmt0(s);
    var s0 := s.(last := None);
    Ready(s0);
    match st
    case Run(_, _, _, _) => AfterRun(s0, Ev(s0, RunEv(n.cmd, r.exit, r.timedOut, s.afterWouldDo)), r)
    case IfYesRun(_, _, _) => AfterExec(s0, Ev(s0, RunEv(n.cmd, r.exit, r.timedOut, s.afterWouldDo)), r)
    case Do(_, _, _) => AfterExec(s0, Ev(s0, EffectEndEv(n.cmd, r.exit, r.timedOut)), r)
    case IfYesDo(_, _, _) => AfterExec(s0, Ev(s0, EffectEndEv(n.cmd, r.exit, r.timedOut)), r)
    case Check(_, cond, _, _) =>
      if cond.Succeeds? then
        // A timeout is a failure, not false (SPEC §4.2).
        var result := if r.timedOut || r.exit.None? then None else Some(r.exit == Some(0));
        AfterCheck(s0, Ev(s0, CheckCmdEv(n.cmd, r.exit, r.timedOut, s.afterWouldDo)), result, None)
      else
        // Explore mode (SPEC §5.4): true, false, or not a number.
        var l, rt := OperandVal(s0.vars, cond.l), OperandVal(s0.vars, cond.r);
        var result := if r.i == 0 then Some(true) else if r.i == 1 then Some(false) else None;
        AfterCheck(s0, Ev(s0, CheckEv(Expr(cond), NumText(l), NumText(rt), result, s.afterWouldDo)), result, Some(CmpDetail(cond, l, rt)))
    case Ask(_, _, _, _, _) => ResumeAsk(s0, st, n.request, r)
    case Page(_, _) =>
      var e := Ev(s0, PageEv(n.text, r.ok));
      Then(e, Finish(Log(s0, e), Paged))
    case _ => assert false; Finish(s0, Stopped)
  }

  // A `run` finished: bind its output, or failure handling.
  function AfterRun(s: State, e: CoreEvent, r: Response): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && s.tasks[0].op.S? && Stmt0(s).Run? && Plain(s, e) && r.ExecResult?
    ensures Post(s, res, Busy(s))
  {
    var s1, b := Log(s, e), Stmt0(s).binding;
    Then(e,
      if !Ok(r) then Failed(s1, None)
      else if b.Some? then RunSlotOk(s1, RunSlot(r.stdout)); BindingOk(s1, RunSlot(r.stdout)); Continue(s1, s1.vars[b.value := RunSlot(r.stdout)])
      else SameOk(s1); Continue(s1, s1.vars))
  }

  // An `if yes run`, `do` or `if yes do` finished: carry on, or failure handling.
  function AfterExec(s: State, e: CoreEvent, r: Response): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s) && s.tasks[0].op.S? && (Stmt0(s).IfYesRun? || Stmt0(s).Do? || Stmt0(s).IfYesDo?) && Plain(s, e) && r.ExecResult?
    ensures Post(s, res, Busy(s))
  {
    Then(e, if Ok(r) then SameOk(Log(s, e)); Continue(Log(s, e), s.vars) else Failed(Log(s, e), None))
  }

  // The backend answered, or failed.
  function ResumeAsk(s0: State, st: Stmt, req: AskRequest, r: Response): (res: (State, seq<CoreEvent>, Next))
    requires Idle(s0) && s0.tasks[0].op.S? && Stmt0(s0) == st && st.Ask? && (r.AskAnswer? || r.AskFailed?)
    requires FormOk(s0.prog, st.form) && req.options == Options(s0.prog, st.form)
    ensures Post(s0, res, Busy(s0))
  {
    var s1 := s0.(askCalls := s0.askCalls + 1);
    CountOk(s0, s1);
    if r.AskFailed? then
      var e := Ev(s1, AskEv(req.question, req.kind, None, None, None, st.sure, false, Some(r.error), s0.afterWouldDo));
      Then(e, Finish(Log(s1, e), Handoff(AskUnavailable, Some(FailureText(r.error)))))
    else Answered(s1, st, req, r)
  }

  // SPEC §5.2. Step after Done isn't allowed (P2), and the response must
  // answer the last request (or be a deadline).
  function Step(s: State, r: Response): (res: (State, seq<CoreEvent>, Next))
    requires Inv(s) && !IsDone(s) && Accepts(s, r)
    ensures Post(s, res, Measure(s))
  {
    if r.DeadlineExceeded? then Finish(s.(last := None), Handoff(Deadline, None))
    else if s.last.None? then Advance(s)
    else Resume(s, r)
  }
}
