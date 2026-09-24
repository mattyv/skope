// The interpreter's state and its invariant (SPEC §5.2, §5.3).
//
// A run is a list of tasks: the statements the current section still has
// to run, with every `for each` unrolled into its iterations when it's
// reached. Each task carries, as ghost fields, the static environment
// stream B's lint analysis assigns to its point in the program
// (SkopWellFormed.Env). The invariant says the runtime variables are always
// modelled by the first task's environment, so every name a command needs
// is bound, and holds a value of an allowed kind (P6, P4).
module SkopState {
  import opened SkopAst
  import opened SkopStep
  import opened SkopWellFormed
  import opened SkopValues

  // ---- runtime values ----

  // A bound variable. `item` is the data-list item a loop variable holds,
  // so `do step` can find its command. `kind` is the static kind (B's
  // Kind) the value has, for the proofs.
  datatype Slot = Slot(b: Bound, item: Option<Item>, ghost kind: Kind)
  type Vars = map<Name, Slot>

  // `list` is the data section an item came from.
  function ItemSlot(it: Item, ghost list: SectionRef): Slot {
    Slot(Bound(Str(Label(it)), FromListItem), Some(it), ItemKind(it, list.id))
  }

  // The concrete env of B's semantics: each bound name and its value's kind.
  ghost function KindMap(vars: Vars): CEnv { map x | x in vars :: vars[x].kind }

  // ---- tasks ----

  datatype Op =
    | S(stmt: Stmt)
    | Bind(v: Name, item: Item, src: Src, ghost list: SectionRef)     // a loop iteration starts
    | Unbind(v: Name, src: Src)                                     // the loop is over
  // gov is the `yes | no` answer that governs an `if yes` (SPEC §4.2). E, lv
  // and gov are B's analysis at this point (SeqOk's arguments).
  datatype Task = Task(op: Op, gov: Option<Name>, ghost E: Env, ghost lv: set<Name>)

  function OpSrc(op: Op): Src {
    match op case S(st) => st.src case Bind(_, _, src, _) => src case Unbind(_, src) => src
  }

  // A body's statements as tasks, each with B's environment before it.
  function Tasks(p: Program, b: seq<Stmt>, gov: Option<Name>, ghost E: Env, ghost lv: set<Name>): seq<Task> {
    if |b| == 0 then []
    else [Task(S(b[0]), gov, E, lv)] + Tasks(p, b[1..], NextGov(b[0], gov), After(p, b[0], E), lv)
  }

  // The iterations over items of a loop reached with env E. An iteration
  // binds the variable (from Eb: E the first time, then what the body left)
  // and runs the body from B's LoopEntry.
  function Iters(p: Program, fe: Stmt, items: seq<Item>, ghost Eb: Env, ghost E: Env, ghost lv: set<Name>): seq<Task>
    requires fe.ForEach?
  {
    if |items| == 0 then []
    else [Task(Bind(fe.loopVar, items[0], fe.src, fe.list), None, Eb, {})]
         + Tasks(p, fe.body, None, LoopEntry(p, fe, E), lv + {fe.loopVar})
         + Iters(p, fe, items[1..], Walk(p, fe.body, LoopEntry(p, fe, E)), E, lv)
  }

  // A `for each` unrolled (SPEC §4.2): each item binds the variable and
  // runs the body; then the variable is unbound (SPEC §3.5: it's scoped to
  // the body, and whatever it held before the loop isn't restored).
  function Expand(p: Program, t: Task): seq<Task>
    requires t.op.S? && t.op.stmt.ForEach? && IsData(p, t.op.stmt.list.id)
  {
    var fe := t.op.stmt;
    Iters(p, fe, DataList(p, fe.list.id).items, t.E, t.E, t.lv)
    + [Task(Unbind(fe.loopVar, fe.src), None, Walk(p, fe.body, LoopEntry(p, fe, t.E)), {})]
  }

  // The loop variables in scope: the loops whose ends are still to come.
  function LoopVars(ts: seq<Task>): set<Name> { set k | 0 <= k < |ts| && ts[k].op.Unbind? :: ts[k].op.v }

  // B's After, extended to the loop bookkeeping.
  ghost function AfterOp(p: Program, op: Op, E: Env): Env {
    match op
    case S(st) => After(p, st, E)
    case Bind(v, _, _, l) => Env(E.bound + {v}, E.kinds[v := ItemKinds(p, l)])
    case Unbind(v, _) => Env(E.bound - {v}, E.kinds - {v})
  }

  // ---- the state ----

  datatype State = State(
    prog: Program,
    cfg: RunConfig,
    sec: SectionId,
    tasks: seq<Task>,
    vars: Vars,
    runNames: set<Name>,    // RunNames(prog), computed once
    last: Option<Next>,     // what the last Step returned; None before the first
    afterWouldDo: bool,     // a would_do has happened (SPEC §4.5)
    askCalls: nat,
    effects: nat,
    ghost log: seq<CoreEvent>) // every event so far

  predicate IsDone(s: State) { s.last.Some? && s.last.value.Done? }
  predicate Pending(s: State) { s.last.Some? && !s.last.value.Done? }

  // The response Step accepts: NoResponse first, then an answer to the last Next.
  predicate Accepts(s: State, r: Response) {
    r.DeadlineExceeded? || (if s.last.None? then r.NoResponse? else Answers(s.last.value, r))
  }

  // ---- what the program and the config must satisfy (checked by the adapter) ----

  // Every name that reaches a command: in a statement's own, or an action item's.
  function CmdNames(p: Program): set<Name> {
    (set s, x | s in Stmts(p) && x in CmdVars(s) :: x)
    + (set id, y | id in p.sections && y in ActionVars(p, id) :: y)
  }
  function RunNames(p: Program): set<Name> {
    set s | s in Stmts(p) && s.Run? && s.binding.Some? :: s.binding.value
  }

  // Params and built-ins as declared, and every one that reaches a command
  // passes the safe-value check (SPEC §3.5; the host reports E-PARAM-UNSAFE).
  predicate InputsOk(p: Program, cfg: RunConfig) {
    var cn := CmdNames(p);
    cfg.params.Keys == p.params.Keys && cfg.builtins.Keys == Builtins
    && (forall x | x in cfg.params && x in cn :: SafeValue(Show(cfg.params[x])))
    && (forall x | x in cfg.builtins && x in cn :: SafeValue(Show(cfg.builtins[x])))
  }

  ghost predicate ProgOk(p: Program, cfg: RunConfig) { WellFormed(p) && InputsOk(p, cfg) }

  ghost function TheIn(p: Program): map<SectionId, Env> requires FlowOk(p) { var In :| FlowOkWith(p, In); In }
  ghost function TheRank(p: Program): map<SectionId, nat> requires Acyclic(p) { var r :| Ranked(p, r); r }

  // ---- the invariant ----

  // The runtime variables are what E says (B's Holds): everything E binds
  // is bound, and every value has one of the kinds E allows for its name.
  ghost predicate Models(vars: Vars, E: Env) { Holds(E, KindMap(vars)) }

  // A slot's value is what its kind says it is.
  ghost predicate SlotOk(p: Program, cfg: RunConfig, x: Name, sl: Slot) {
    match sl.kind
    case KParam => x in cfg.params && sl.b == Bound(cfg.params[x], FromParam)
    case KBuiltin => x in cfg.builtins && sl.b == Bound(cfg.builtins[x], FromBuiltin)
    case KRun => sl.b.origin == FromRunOutput && sl.b.value.Str? && x in RunNames(p)
    case KValue(l) =>
      IsData(p, l) && sl.b.origin == FromListItem
      && exists it <- DataList(p, l).items :: it.Value? && sl.b.value == Str(it.value)
    case KAction(l) =>
      IsData(p, l) && sl.b.origin == FromListItem && sl.item.Some? && sl.item.value.Action?
      && sl.item.value in DataList(p, l).items && sl.b.value == Str(sl.item.value.text)
    case KYesNo => sl.b == Bound(Str("yes"), FromYesNo) || sl.b == Bound(Str("no"), FromYesNo)
    // P5: a Score variable holds a level of its ask, LOW..HIGH.
    case KScore =>
      sl.b.origin == FromScore && sl.b.value.Int?
      && exists st <- Stmts(p) :: st.Ask? && st.form.Score? && st.form.binding == x
                                  && st.form.low <= sl.b.value.i <= st.form.high
  }
  ghost predicate VarsOk(p: Program, cfg: RunConfig, vars: Vars) {
    forall x | x in vars :: SlotOk(p, cfg, x, vars[x])
  }

  ghost predicate TaskOk(p: Program, cfg: RunConfig, sec: SectionId, t: Task)
    requires ProgOk(p, cfg) && IsInstr(p, sec)
  {
    match t.op
    case S(st) => st in Flat(Body(p, sec)) && StmtOk(p, TheIn(p), st, t.E, t.lv, t.gov)
    case Bind(_, it, _, l) => IsData(p, l.id) && it in DataList(p, l.id).items
    case Unbind(_, _) => true
  }

  ghost predicate Chain(p: Program, ts: seq<Task>) {
    forall k | 0 <= k < |ts| - 1 :: Approx(ts[k + 1].E, AfterOp(p, ts[k].op, ts[k].E))
  }

  // Some task never carries on, so the list never runs out (no falling off).
  ghost predicate Ends(ts: seq<Task>) {
    exists k | 0 <= k < |ts| :: ts[k].op.S? && Terminal(ts[k].op.stmt)
  }

  // A run that hasn't ended: its tasks are typed, chained, end in a
  // statement that never carries on, and the variables are modelled.
  ghost predicate Running(s: State) {
    ProgOk(s.prog, s.cfg) && IsInstr(s.prog, s.sec) && VarsOk(s.prog, s.cfg, s.vars)
    && |s.tasks| > 0 && Ends(s.tasks)
    && (forall k | 0 <= k < |s.tasks| :: TaskOk(s.prog, s.cfg, s.sec, s.tasks[k]))
    && Chain(s.prog, s.tasks)
    && Scoped(s.tasks)
    && Models(s.vars, s.tasks[0].E)
    && s.runNames == RunNames(s.prog)
  }

  // The loop variables in scope for a statement are exactly those of the
  // loops still to end after it.
  ghost predicate Scoped(ts: seq<Task>) {
    forall j | 0 <= j < |ts| && ts[j].op.S? :: ts[j].lv == LoopVars(ts[j + 1..])
  }

  predicate IsRead(e: EventBody) { e.RunEv? || e.CheckCmdEv? || e.CheckEv? || e.AskEv? }

  // SPEC §4.5: a read carries after_would_do exactly when a would_do came before it.
  ghost predicate Marked(log: seq<CoreEvent>) {
    forall i | 0 <= i < |log| && IsRead(log[i].body) ::
      log[i].body.afterWouldDo == exists j | 0 <= j < i :: log[j].body.WouldDoEv?
  }

  ghost predicate LogOk(s: State) {
    (s.afterWouldDo == exists j | 0 <= j < |s.log| :: s.log[j].body.WouldDoEv?)
    && Marked(s.log)
    // P2: one outcome event, last, exactly when the run is done.
    && (forall i | 0 <= i < |s.log| && s.log[i].body.OutcomeEv? :: i == |s.log| - 1)
    && (IsDone(s) <==> exists j | 0 <= j < |s.log| :: s.log[j].body.OutcomeEv?)
    // P3 in the log: a dry run never reports an effect or a page.
    && (s.cfg.dry ==> forall e <- s.log :: !e.body.EffectStartEv? && !e.body.PageEv?)
  }

  ghost predicate Inv(s: State) {
    ProgOk(s.prog, s.cfg) && IsInstr(s.prog, s.sec) && VarsOk(s.prog, s.cfg, s.vars) && LogOk(s)
    && (!IsDone(s) ==> Running(s))
    && (Pending(s) ==> Running(s) && Issues(s) && s.last.value == IssueNext(s))
  }

  // ---- rendering (SPEC §3.5) ----

  predicate CmdBound(vars: Vars, c: Parts) { forall pt <- c :: pt.Var? ==> pt.name in vars }

  function RenderCmd(vars: Vars, c: Parts): string requires CmdBound(vars, c) {
    if |c| == 0 then "" else (if c[0].Lit? then c[0].s else Show(vars[c[0].name].b.value)) + RenderCmd(vars, c[1..])
  }
  ghost function CmdPieces(vars: Vars, c: Parts): seq<Piece> requires CmdBound(vars, c) {
    if |c| == 0 then []
    else [if c[0].Lit? then AuthorLit(c[0].s) else Trusted(Show(vars[c[0].name].b.value), vars[c[0].name].b.origin)]
         + CmdPieces(vars, c[1..])
  }
  ghost function Concat(ps: seq<Piece>): string { if |ps| == 0 then "" else ps[0].s + Concat(ps[1..]) }

  const Unavailable := "(unavailable)"

  // Page text: everything pasted in; an unbound name is "(unavailable)".
  function RenderText(vars: Vars, c: Parts): string {
    if |c| == 0 then ""
    else (match c[0] case Lit(l) => l case Var(x) => if x in vars then Show(vars[x].b.value) else Unavailable)
         + RenderText(vars, c[1..])
  }

  // Question text: a trusted value is pasted in; run output, or a name that
  // could hold it, is named in backticks and sent as context.
  // rn is RunNames(p): the names that may hold run output.
  function QPart(rn: set<Name>, vars: Vars, x: Name): string {
    if x in vars then (if vars[x].b.origin == FromRunOutput then "`" + x + "`" else Show(vars[x].b.value))
    else if x in rn then "`" + x + "`"
    else Unavailable
  }
  function RenderQ(rn: set<Name>, vars: Vars, q: Parts): string {
    if |q| == 0 then "" else (match q[0] case Lit(l) => l case Var(x) => QPart(rn, vars, x)) + RenderQ(rn, vars, q[1..])
  }
  ghost function QPieces(rn: set<Name>, vars: Vars, q: Parts): seq<Piece> {
    if |q| == 0 then []
    else [match q[0]
          case Lit(l) => AuthorLit(l)
          case Var(x) =>
            if x in vars && vars[x].b.origin != FromRunOutput then Trusted(Show(vars[x].b.value), vars[x].b.origin)
            else AuthorLit(QPart(rn, vars, x))]
         + QPieces(rn, vars, q[1..])
  }
  predicate InContext(rn: set<Name>, vars: Vars, x: Name) {
    if x in vars then vars[x].b.origin == FromRunOutput else x in rn
  }
  // SPEC §6.3: exactly the names in the question that hold run output.
  function Context(rn: set<Name>, vars: Vars, q: Parts): map<Name, string> {
    map x | x in PartVars(q) && InContext(rn, vars, x) :: if x in vars then Show(vars[x].b.value) else Unavailable
  }

  // ---- asks (SPEC §6.1) ----

  ghost predicate FormOk(p: Program, form: AskForm) {
    match form
    case Sections(opts) => forall o <- opts :: IsInstr(p, o.ref.id)
    case YesNo(_) => true
    case OneOf(l, _) => IsData(p, l.id) && forall it <- DataList(p, l.id).items :: it.Value?
    case Score(lo, hi, _, _) => 0 <= lo < hi
  }

  function RubricText(rubric: seq<RubricLine>, n: int): Option<string> {
    if |rubric| == 0 then None else if rubric[0].level == n then Some(rubric[0].text) else RubricText(rubric[1..], n)
  }

  function SectionOpts(p: Program, opts: seq<AskOption>): (r: seq<AskOpt>)
    requires forall o <- opts :: IsInstr(p, o.ref.id)
    ensures |r| == |opts|
  {
    if |opts| == 0 then []
    else assert opts[0] in opts && IsInstr(p, opts[0].ref.id); var sec := p.sections[opts[0].ref.id]; [AskOpt(opts[0].ref.id, sec.name, sec.guidance)] + SectionOpts(p, opts[1..])
  }
  function ValueOpts(items: seq<Item>): (r: seq<AskOpt>) requires forall it <- items :: it.Value? ensures |r| == |items| {
    if |items| == 0 then [] else [AskOpt(items[0].value, items[0].value, None)] + ValueOpts(items[1..])
  }
  function LevelOpts(rubric: seq<RubricLine>, lo: int, n: nat): (r: seq<AskOpt>) ensures |r| == n decreases n {
    if n == 0 then [] else [AskOpt(IntToString(lo), IntToString(lo), RubricText(rubric, lo))] + LevelOpts(rubric, lo + 1, n - 1)
  }

  // The author's options, in order.
  function Options(p: Program, form: AskForm): seq<AskOpt> requires FormOk(p, form) {
    match form
    case Sections(opts) => SectionOpts(p, opts)
    case YesNo(_) => [AskOpt("yes", "yes", None), AskOpt("no", "no", None)]
    case OneOf(l, _) => ValueOpts(DataList(p, l.id).items)
    case Score(lo, hi, rubric, _) => LevelOpts(rubric, lo, hi - lo + 1)
  }

  function KindOf(form: AskForm): AskKind {
    match form case Sections(_) => Choice case YesNo(_) => YesNoKind case OneOf(_, _) => Choice case Score(_, _, _, _) => ScoreKind
  }

  // timeoutMs is ask.timeout_ms from config, which the core doesn't see:
  // the host fills it in.
  function AskReq(p: Program, sec: SectionId, vars: Vars, rn: set<Name>, q: Parts, form: AskForm): AskRequest
    requires IsInstr(p, sec) && FormOk(p, form)
  {
    AskRequest(KindOf(form), RenderQ(rn, vars, q), p.sections[sec].guidance, Options(p, form), Context(rn, vars, q), 0)
  }

  // ---- requests ----

  predicate Yes(vars: Vars, gov: Option<Name>) { gov.Some? && gov.value in vars && vars[gov.value].b.value == Str("yes") }
  predicate Unknown(vars: Vars, o: Operand) { o.VarOp? && o.name in vars && vars[o.name].b.origin == FromRunOutput }

  // The first task needs something from the host.
  predicate Issues(s: State) requires |s.tasks| > 0 {
    var t := s.tasks[0];
    t.op.S? &&
    match t.op.stmt
    case Run(_, _, _, _) => true
    case Do(_, _, _) => !s.cfg.dry
    case Check(_, cond, _, _) =>
      cond.Succeeds? || (s.cfg.mode == Explore && (Unknown(s.vars, cond.l) || Unknown(s.vars, cond.r)))
    case Ask(_, _, _, _, _) => true
    case IfYesRun(_, _, _) => Yes(s.vars, t.gov)
    case IfYesDo(_, _, _) => Yes(s.vars, t.gov) && !s.cfg.dry
    case Page(_, _) => !s.cfg.dry
    case _ => false
  }

  predicate DoReady(vars: Vars, a: DoBody) {
    a.DoItem? ==> a.item in vars && vars[a.item].item.Some? && vars[a.item].item.value.Action?
                  && CmdBound(vars, vars[a.item].item.value.cmd)
  }
  // A `do`'s command: its own, or its loop item's.
  function DoParts(vars: Vars, a: DoBody): Parts requires DoReady(vars, a) {
    match a case DoCmd(c) => c case DoItem(x) => vars[x].item.value.cmd
  }

  function ExecOf(vars: Vars, c: Parts, kind: ExecKind, timeoutMs: nat, src: Src): Next requires CmdBound(vars, c) {
    Exec(RenderCmd(vars, c), kind, timeoutMs, src, CmdPieces(vars, c))
  }

  function IssueNext(s: State): (n: Next) requires Running(s) && Issues(s) ensures !n.Done? {
    var p := s.prog;
    var st := s.tasks[0].op.stmt;
    Ready(s);
    match st
    case Run(src, c, _, _) => ExecOf(s.vars, c, RunExec, p.limits.runTimeoutMs, src)
    case Do(src, a, _) => ExecOf(s.vars, DoParts(s.vars, a), DoExec, p.limits.doTimeoutMs, src)
    case Check(src, cond, _, _) =>
      if cond.Succeeds? then ExecOf(s.vars, cond.cmd, CheckExec, p.limits.runTimeoutMs, src) else Choose(3)
    case Ask(src, q, _, form, _) => AskNext(AskReq(p, s.sec, s.vars, s.runNames, q, form), src)
    case IfYesRun(src, c, _) => ExecOf(s.vars, c, RunExec, p.limits.runTimeoutMs, src)
    case IfYesDo(src, a, _) => ExecOf(s.vars, DoParts(s.vars, a), DoExec, p.limits.doTimeoutMs, src)
    case Page(src, text) => PageNext(RenderText(s.vars, text), src)
    case _ => assert false; Choose(0)
  }

  // ---- P1: the measure ----

  ghost function CostBody(p: Program, b: seq<Stmt>): nat {
    if |b| == 0 then 0
    else (match b[0]
          case ForEach(_, _, l, bb) => 2 + (if IsData(p, l.id) then |DataList(p, l.id).items| else 0) * (1 + CostBody(p, bb))
          case _ => 1) + CostBody(p, b[1..])
  }
  ghost function OpCost(p: Program, op: Op): nat { match op case S(st) => CostBody(p, [st]) case _ => 1 }
  ghost function Rem(p: Program, ts: seq<Task>): nat { if |ts| == 0 then 0 else OpCost(p, ts[0].op) + Rem(p, ts[1..]) }

  ghost function Weight(p: Program, id: SectionId): nat requires IsInstr(p, id) { 2 * CostBody(p, Body(p, id)) + 2 }
  ghost function InstrIds(p: Program): set<SectionId> { set id | id in p.sections && IsInstr(p, id) }
  ghost function Below(p: Program, id: SectionId): set<SectionId> requires Acyclic(p) && IsInstr(p, id) {
    var r := TheRank(p);
    set x | x in p.sections && IsInstr(p, x) && r[x] < r[id]
  }
  ghost function SumW(p: Program, xs: set<SectionId>): nat requires forall x <- xs :: IsInstr(p, x) decreases xs {
    if xs == {} then 0 else var x :| x in xs; Weight(p, x) + SumW(p, xs - {x})
  }

  // Sections below this one in the ranking can still run, plus what's left here.
  ghost function Measure(s: State): nat requires WellFormed(s.prog) && IsInstr(s.prog, s.sec) {
    SumW(s.prog, Below(s.prog, s.sec)) + 2 * Rem(s.prog, s.tasks) + (if Pending(s) then 0 else 1)
  }
  // P1's bound: at most this many Steps from Start to Done.
  ghost function StepBound(p: Program): nat requires WellFormed(p) { SumW(p, InstrIds(p)) }

  // ---- P3, P4: what a request may contain ----

  // The command a statement hands out under this kind, if any.
  function TemplateOf(st: Stmt, kind: ExecKind): Option<Parts> {
    match st
    case Run(_, c, _, _) => if kind == RunExec then Some(c) else None
    case IfYesRun(_, c, _) => if kind == RunExec then Some(c) else None
    case Check(_, Succeeds(c), _, _) => if kind == CheckExec then Some(c) else None
    case Do(_, DoCmd(c), _) => if kind == DoExec then Some(c) else None
    case IfYesDo(_, DoCmd(c), _) => if kind == DoExec then Some(c) else None
    case _ => None
  }
  ghost predicate ActionCmd(p: Program, c: Parts) {
    exists id | IsData(p, id) :: exists it <- DataList(p, id).items :: it.Action? && it.cmd == c
  }

  // A value from a param, a built-in, a data list, a yes/no or Score answer: never run output.
  ghost predicate TrustedValue(p: Program, cfg: RunConfig, v: string) {
    (exists x | x in cfg.params :: Show(cfg.params[x]) == v)
    || (exists x | x in cfg.builtins :: Show(cfg.builtins[x]) == v)
    || (exists id | IsData(p, id) :: exists it <- DataList(p, id).items :: Label(it) == v)
    || v == "yes" || v == "no" || AllDigits(v)
  }

  // Pieces built from an author template: its literals, and for each name a
  // trusted value that passed the safe-value check.
  ghost predicate PiecesMatch(p: Program, cfg: RunConfig, c: Parts, ps: seq<Piece>) {
    |c| == |ps|
    && forall i | 0 <= i < |c| ::
         (c[i].Lit? ==> ps[i] == AuthorLit(c[i].s))
         && (c[i].Var? ==> ps[i].Trusted? && ps[i].origin != FromRunOutput && SafeValue(ps[i].s) && TrustedValue(p, cfg, ps[i].s))
  }

  ghost predicate FromTemplate(p: Program, cfg: RunConfig, kind: ExecKind, ps: seq<Piece>) {
    (exists st <- Stmts(p) :: TemplateOf(st, kind).Some? && PiecesMatch(p, cfg, TemplateOf(st, kind).value, ps))
    || (kind == DoExec && exists c | ActionCmd(p, c) :: PiecesMatch(p, cfg, c, ps))
  }

  // A question: author literals, trusted values, and names in backticks
  // (or "(unavailable)") where run output would go (SPEC §3.5).
  ghost predicate QPiecesMatch(p: Program, cfg: RunConfig, q: Parts, ps: seq<Piece>) {
    |q| == |ps|
    && forall i | 0 <= i < |q| ::
         (q[i].Lit? ==> ps[i] == AuthorLit(q[i].s))
         && (q[i].Var? ==>
               ps[i] == AuthorLit("`" + q[i].name + "`") || ps[i] == AuthorLit(Unavailable)
               || (ps[i].Trusted? && ps[i].origin != FromRunOutput && TrustedValue(p, cfg, ps[i].s)))
  }

  ghost predicate AskReqOk(p: Program, cfg: RunConfig, req: AskRequest) {
    exists st <- Stmts(p) ::
      st.Ask? && FormOk(p, st.form) && req.kind == KindOf(st.form) && req.options == Options(p, st.form)
      && (exists ps :: req.question == Concat(ps) && QPiecesMatch(p, cfg, st.question, ps))
      && forall x | x in req.context :: x in PartVars(st.question) && x in RunNames(p)
  }

  // P3 and P4 for one request.
  ghost predicate NextOk(p: Program, cfg: RunConfig, n: Next) {
    (n.Exec? ==> n.cmd == Concat(n.pieces) && FromTemplate(p, cfg, n.kind, n.pieces))
    && (n.AskNext? ==> AskReqOk(p, cfg, n.request))
    && (cfg.dry ==> !n.PageNext? && !(n.Exec? && n.kind == DoExec))
    && (n.Choose? ==> cfg.mode == Explore && n.n == 3)
  }

  // Params and built-ins; a param wins a clash (B's Initial).
  function InitVars(cfg: RunConfig): Vars {
    (map x | x in cfg.builtins :: Slot(Bound(cfg.builtins[x], FromBuiltin), None, KBuiltin))
    + (map x | x in cfg.params :: Slot(Bound(cfg.params[x], FromParam), None, KParam))
  }
  function StartState(p: Program, cfg: RunConfig): State requires WellFormed(p) {
    State(p, cfg, p.entry.section, Tasks(p, Body(p, p.entry.section), None, TheIn(p)[p.entry.section], {}),
          InitVars(cfg), RunNames(p), None, false, 0, 0, [])
  }
  // Control moves to section id (SPEC §4.1), logging e. The loops it
  // leaves are over, so their variables are unbound (SPEC §3.5).
  function Enter(s: State, id: SectionId, e: CoreEvent): State
    requires WellFormed(s.prog) && IsInstr(s.prog, id) && id in TheIn(s.prog)
  {
    s.(log := s.log + [e], sec := id, tasks := Tasks(s.prog, Body(s.prog, id), None, TheIn(s.prog)[id], {}),
       vars := s.vars - LoopVars(s.tasks))
  }

  ghost predicate Idle(s: State) { Inv(s) && s.last.None? }
  function Stmt0(s: State): Stmt requires |s.tasks| > 0 && s.tasks[0].op.S? { s.tasks[0].op.stmt }

  ghost function Base(s: State): nat requires WellFormed(s.prog) && IsInstr(s.prog, s.sec) {
    SumW(s.prog, Below(s.prog, s.sec))
  }
  // The measure while the first task is under way.
  ghost function Busy(s: State): nat requires WellFormed(s.prog) && IsInstr(s.prog, s.sec) {
    Base(s) + 2 * Rem(s.prog, s.tasks)
  }

  // ---- lemmas ----

  // What a Running state's first statement can rely on (P6): B's SafeAt,
  // from its simulation lemma, and what that means for the variables.
  lemma Ready(s: State)
    requires Running(s)
    ensures s.tasks[0].op.S? ==>
      var st := s.tasks[0].op.stmt;
      st in Stmts(s.prog)
      && SafeAt(s.prog, st, KindMap(s.vars), s.tasks[0].gov)
      && (forall x <- CmdVars(st) :: x in s.vars)
      && (forall x <- OperandVars(st) :: x in s.vars)
      && ((st.Do? || st.IfYesDo?) ==> DoReady(s.vars, st.action))
      && (st.Ask? ==> FormOk(s.prog, st.form))
      && (st.ForEach? ==> IsData(s.prog, st.list.id))
  {
    var p, t := s.prog, s.tasks[0];
    if t.op.S? {
      var st, c := t.op.stmt, KindMap(s.vars);
      assert st in Stmts(p);
      StmtSim(p, TheIn(p), st, t.E, t.lv, t.gov, c);
      if (st.Do? || st.IfYesDo?) && st.action.DoItem? {
        var x := st.action.item;
        assert x in DoItems(st);
        var sl := s.vars[x];
        assert SlotOk(p, s.cfg, x, sl);
        var it := sl.item.value;
        forall pt <- it.cmd | pt.Var? ensures pt.name in s.vars {
          assert it in DataList(p, sl.kind.list).items && pt.name in PartVars(it.cmd);
          assert pt.name in ActionVars(p, sl.kind.list);
        }
      }
      if st.Ask? && st.form.Sections? {
        forall o <- st.form.options ensures IsInstr(p, o.ref.id) {
          var k :| 0 <= k < |st.form.options| && st.form.options[k] == o;
          assert Jump(o.ref, o.src) in Jumps(st);
        }
      }
      if st.Ask? && st.form.OneOf? {
        assert st.form.list in ListRefs(st);
      }
      if st.Ask? && st.form.Score? {
        assert AskOk(st);
      }
      if st.ForEach? {
        assert st.list in ListRefs(st);
      }
    }
  }
}
