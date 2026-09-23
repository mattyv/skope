// What a clean lint guarantees the interpreter (SPEC §5.3 P6). SkopCheck
// proves Lint(p) == [] ==> WellFormed(p), so the interpreter can require
// WellFormed(p) and never meet a missing section or list, an unbound name,
// or a value of the wrong kind.
//
// Each conjunct covers one family of SPEC §7.1 lint codes, named beside it.
//
// How the interpreter uses it (the simulation contract, at the end):
// - A concrete env is a map from each bound name to the Kind of its value
//   (CEnv). What each statement may do to it is stated plainly by
//   Completes (it finishes and the run carries on), TransferEnv (it leaves
//   the section, or loop, for a jump target) and Initial (the run's start).
//   The interpreter must behave within these relations.
// - FlowOk gives an abstract env In[id] for each section the run can
//   reach, and SeqOk checks each body against it. Holds(A, c) says the
//   abstract env A soundly describes the concrete c.
// - Then, with Holds(A, c) before a statement s that StmtOk accepts,
//   StmtSim gives: SafeAt(p, s, c, gov) (every name a command, comparison,
//   `do item` or `if yes` reads is bound, with a kind it may have there:
//   P4 and P6), Holds(After(p, s, A), c') for every c' s can complete
//   with, and Holds(In[target], c') for every c' it can transfer with.
//   EntrySim starts the chain; NeverFallsOff says no section body just
//   ends; Acyclic gives the termination rank.
module SkopWellFormed {
  import opened SkopAst

  ghost predicate WellFormed(p: Program) {
    EntryOk(p)          // E-UNRESOLVED, E-REF-KIND (at the entry line)
    && RefsOk(p)        // E-UNRESOLVED, E-REF-KIND, E-SECTION-KIND
    && ListsOk(p)       // E-LIST-EMPTY, E-LIST-MIXED, E-LIST-DUP, E-LIST-KIND (one of)
    && Acyclic(p)       // E-CYCLE
    && Structured(p)    // E-FALLS-OFF, E-UNREACHABLE
    && ChecksOk(p)      // E-GRAMMAR (a check with neither target nor else)
    && AsksOk(p)        // E-OPTION-COUNT, E-ELSE-SKIP, E-SCORE-RANGE, E-SCORE-RUBRIC
    && NamesKnown(p)    // E-UNBOUND (a question or page names something never bound)
    && ActionCmdsOk(p)  // E-UNBOUND, E-TAINT, E-UNSAFE-VALUE (in an action item's command)
    && FlowOk(p)        // E-UNBOUND, E-TAINT, E-ACTION-IN-CMD, E-UNSAFE-VALUE, E-IF-YES, E-LIST-KIND (do item)
  }

  // Built-in names (SPEC §3.5).
  const Builtins: set<Name> := {"host", "run_id", "skill"}

  // ---- sections and references (SPEC §3.2, §5.1) ----

  predicate IsInstr(p: Program, id: SectionId) {
    id in p.sections && p.sections[id].Instructions?
  }

  function Body(p: Program, id: SectionId): seq<Stmt>
    requires IsInstr(p, id)
  {
    p.sections[id].body
  }

  // A data section: a non-instruction section with exactly one list.
  predicate IsData(p: Program, id: SectionId) {
    id in p.sections && p.sections[id].Other? && |p.sections[id].lists| == 1
  }

  function DataList(p: Program, id: SectionId): List
    requires IsData(p, id)
  {
    p.sections[id].lists[0]
  }

  // A real link's anchor must be the section's slug (SPEC §3.4).
  predicate AnchorOk(r: SectionRef) {
    r.anchor.None? || r.anchor.value.given == r.anchor.value.expected
  }

  // Every statement of a body, loop bodies included, in document order.
  function Flat(body: seq<Stmt>): seq<Stmt> {
    if |body| == 0 then []
    else [body[0]] + (if body[0].ForEach? then Flat(body[0].body) else []) + Flat(body[1..])
  }

  // Every statement of every instruction section.
  function Stmts(p: Program): set<Stmt> {
    set id, s | id in p.sections && p.sections[id].Instructions? && s in Flat(p.sections[id].body) :: s
  }

  // A transfer (SPEC §4.1): `then`, `→ [X]`, `else [X]`, or a section
  // option. `src` is the line of the statement, or of the option.
  datatype Jump = Jump(ref: SectionRef, src: Src)

  function ElseJump(e: Else, src: Src): set<Jump> {
    if e.ElseTo? then {Jump(e.ref, src)} else {}
  }

  // A statement's own transfers, not those inside a loop body.
  function Jumps(s: Stmt): set<Jump> {
    match s
    case Run(src, _, _, els) => ElseJump(els, src)
    case Do(src, _, els) => ElseJump(els, src)
    case Check(src, _, onTrue, els) =>
      (if onTrue.Some? && onTrue.value.To? then {Jump(onTrue.value.ref, src)} else {}) + ElseJump(els, src)
    case Ask(src, _, _, form, els) =>
      (if form.Sections? then set k | 0 <= k < |form.options| :: Jump(form.options[k].ref, form.options[k].src) else {}) + ElseJump(els, src)
    case ForEach(_, _, _, _) => {}
    case IfYesRun(src, _, els) => ElseJump(els, src)
    case IfYesDo(src, _, els) => ElseJump(els, src)
    case Then(src, r) => {Jump(r, src)}
    case Page(_, _) => {}
    case HandOff(_) => {}
    case Stop(_) => {}
  }

  // The lists a statement names: `for each … in [L]`, `one of [L]`.
  function ListRefs(s: Stmt): set<SectionRef> {
    if s.ForEach? then {s.list}
    else if s.Ask? && s.form.OneOf? then {s.form.list}
    else {}
  }

  ghost predicate EntryOk(p: Program) {
    IsInstr(p, p.entry.section)
  }

  // Targets are instruction sections; lists are data sections.
  ghost predicate RefsOk(p: Program) {
    forall s <- Stmts(p) ::
      (forall j <- Jumps(s) :: AnchorOk(j.ref) && IsInstr(p, j.ref.id))
      && (forall r <- ListRefs(s) :: AnchorOk(r) && IsData(p, r.id))
  }

  // ---- data lists (SPEC §3.6) ----

  function Label(i: Item): string {
    if i.Action? then i.text else i.value
  }

  // ponytail: ASCII case folding only (Dafny has no Unicode case tables);
  // add a folding table if labels outside ASCII turn up.
  function Lower(s: string): string {
    seq(|s|, k requires 0 <= k < |s| => if 'A' <= s[k] <= 'Z' then (s[k] as int + 32) as char else s[k])
  }

  predicate DataListOk(l: List) {
    |l.items| > 0
    && (forall i <- l.items :: i.Action? == l.items[0].Action?)
    && forall a, b | 0 <= a < b < |l.items| :: Lower(Label(l.items[a])) != Lower(Label(l.items[b]))
  }

  ghost predicate ListsOk(p: Program) {
    forall s <- Stmts(p) ::
      (forall r <- ListRefs(s) | IsData(p, r.id) :: DataListOk(DataList(p, r.id)))
      && (s.Ask? && s.form.OneOf? && IsData(p, s.form.list.id) ==>
            forall i <- DataList(p, s.form.list.id).items :: i.Value?)
  }

  // ---- the transfer graph is acyclic (SPEC §4.6) ----

  // Some rank drops along every transfer, so a run visits finitely many
  // sections. The interpreter can use the rank as its termination measure.
  ghost predicate Acyclic(p: Program) {
    exists rank: map<SectionId, nat> :: Ranked(p, rank)
  }

  ghost predicate Ranked(p: Program, rank: map<SectionId, nat>) {
    forall id | IsInstr(p, id) ::
      id in rank
      && forall s <- Flat(Body(p, id)), j <- Jumps(s) | IsInstr(p, j.ref.id) ::
           j.ref.id in rank && rank[j.ref.id] < rank[id]
  }

  // ---- every path ends, and every instruction can run (SPEC §4.1) ----

  // Every way out of it ends the run or transfers. A loop whose body always
  // does counts: lists are never empty, so the body runs at least once.
  predicate Terminal(s: Stmt) {
    s.Then? || s.Page? || s.HandOff? || s.Stop?
    || (s.Ask? && s.form.Sections?)
    || (s.Check? && s.onTrue.Some? && s.els.ElseTo?)
    || (s.ForEach? && |s.body| > 0 && Terminal(s.body[|s.body| - 1]))
  }

  predicate NoDeadCode(body: seq<Stmt>) {
    forall i | 0 <= i < |body| - 1 :: !Terminal(body[i])
  }

  ghost predicate Structured(p: Program) {
    forall id | IsInstr(p, id) ::
      |Body(p, id)| > 0 && Terminal(Body(p, id)[|Body(p, id)| - 1])
      && NoDeadCode(Body(p, id))
      && forall s <- Flat(Body(p, id)) | s.ForEach? :: NoDeadCode(s.body)
  }

  // `check COND` with neither a target nor an else means nothing (SPEC §3.4).
  ghost predicate ChecksOk(p: Program) {
    forall s <- Stmts(p) | s.Check? :: s.onTrue.Some? || !s.els.NoElse?
  }

  // ---- ask forms (SPEC §3.4, §4.2, §4.7) ----

  predicate RubricOk(low: int, high: int, rubric: seq<RubricLine>) {
    (forall r <- rubric :: low <= r.level <= high)
    && (forall a, b | 0 <= a < b < |rubric| :: rubric[a].level != rubric[b].level)
    && forall level | low <= level <= high :: level in Levels(rubric)
  }

  function Levels(rubric: seq<RubricLine>): set<int> {
    set r <- rubric :: r.level
  }

  predicate AskOk(s: Stmt)
    requires s.Ask?
  {
    match s.form
    case Sections(opts) =>
      2 <= |opts| <= 255 && !s.els.Skip?
      && forall a, b | 0 <= a < b < |opts| :: opts[a].ref.id != opts[b].ref.id
    case YesNo(_) => true
    case OneOf(_, _) => !s.els.Skip?
    case Score(low, high, rubric, _) =>
      !s.els.Skip? && 0 <= low < high && high - low < 10 && RubricOk(low, high, rubric)
  }

  ghost predicate AsksOk(p: Program) {
    forall s <- Stmts(p) | s.Ask? :: AskOk(s)
  }

  // ---- names (SPEC §3.5) ----

  function PartVars(ps: Parts): set<Name> {
    set q <- ps | q.Var? :: q.name
  }

  // The name a statement binds when it completes normally. A loop variable
  // isn't here: it's scoped to the loop body.
  function Binding(s: Stmt): Option<Name> {
    if s.Run? then s.binding
    else if s.Ask? && s.form.YesNo? then Some(s.form.binding)
    else if s.Ask? && s.form.OneOf? then Some(s.form.binding)
    else if s.Ask? && s.form.Score? then Some(s.form.binding)
    else None
  }

  function BindingSet(s: Stmt): set<Name> {
    if Binding(s).Some? then {Binding(s).value} else {}
  }

  // Every name an instruction binds: `run … as`, `ask … as`, loop variables.
  function Rebound(p: Program): set<Name> {
    var stmts := Stmts(p);
    (set s <- stmts | Binding(s).Some? :: Binding(s).value)
    + (set s <- stmts | s.ForEach? :: s.loopVar)
  }

  // Every name the program can bind anywhere.
  function AllNames(p: Program): set<Name> {
    p.params.Keys + Builtins + Rebound(p)
  }

  // Names in question and page text. They may be unbound on some path
  // (they render as "(unavailable)"), but not on every path.
  function TextVars(s: Stmt): set<Name> {
    if s.Ask? then PartVars(s.question) else if s.Page? then PartVars(s.text) else {}
  }

  ghost predicate NamesKnown(p: Program) {
    forall s <- Stmts(p) :: TextVars(s) <= AllNames(p)
  }

  // An action item's command runs wherever `do item` is, so it may name
  // only params and built-ins that nothing rebinds (SPEC §3.5).
  ghost predicate ActionCmdsOk(p: Program) {
    forall s <- Stmts(p) | s.ForEach? && IsData(p, s.list.id) ::
      forall i <- DataList(p, s.list.id).items | i.Action? ::
        forall y <- PartVars(i.cmd) ::
          y in p.params.Keys + Builtins && y !in Rebound(p)
          && (y in p.params ==> SafeParam(p.params[y]))
  }

  // ---- bound names, taint and kinds, along every path (SPEC §3.5) ----

  // Where a value came from. A list item carries its list, so the
  // safe-value check knows which items can reach a command, and `do item`
  // knows which commands it may run.
  datatype Kind = KParam | KBuiltin | KRun | KValue(list: SectionId) | KAction(list: SectionId) | KYesNo | KScore

  // What's known at a point in a run: `bound` holds the names bound on
  // every path to it, and `kinds[x]` every kind x may hold on some path.
  datatype Env = Env(bound: set<Name>, kinds: map<Name, set<Kind>>)

  // `a` soundly summarises `b`: what `a` says is bound, `b` binds, and
  // whatever `b` may hold, `a` allows.
  predicate Approx(a: Env, b: Env) {
    a.bound <= b.bound && forall x | x in b.kinds :: x in a.kinds && b.kinds[x] <= a.kinds[x]
  }

  function KindsOf(e: Env, x: Name): set<Kind> {
    if x in e.kinds then e.kinds[x] else {}
  }

  // At the start of a run: params and built-ins.
  function EntryEnv(p: Program): Env {
    var names := p.params.Keys + Builtins;
    Env(names, map x | x in names ::
      (if x in p.params then {KParam} else {}) + (if x in Builtins then {KBuiltin} else {}))
  }

  // What a statement's binding holds.
  function BindKinds(s: Stmt): set<Kind> {
    if s.Run? then {KRun}
    else if s.Ask? && s.form.YesNo? then {KYesNo}
    else if s.Ask? && s.form.OneOf? then {KValue(s.form.list.id)}
    else if s.Ask? && s.form.Score? then {KScore}
    else {}
  }

  function ItemKind(i: Item, list: SectionId): Kind {
    if i.Action? then KAction(list) else KValue(list)
  }

  // What a loop variable over [r] holds.
  function ItemKinds(p: Program, r: SectionRef): set<Kind> {
    if IsData(p, r.id) then set i <- DataList(p, r.id).items :: ItemKind(i, r.id) else {}
  }

  function Forget(e: Env, xs: set<Name>): Env {
    Env(e.bound - xs, e.kinds)
  }

  // After a statement completes normally (it didn't end the run or transfer).
  function After(p: Program, s: Stmt, e: Env): Env
    decreases s, 1
  {
    if s.ForEach? then LoopExit(p, s, e)
    else if Binding(s).None? then e
    else
      var x := Binding(s).value;
      // `run … as x · else skip` binds x only if the command succeeded.
      if s.Run? && s.els.Skip? then Env(e.bound - {x}, e.kinds[x := {KRun}])
      else Env(e.bound + {x}, e.kinds[x := BindKinds(s)])
  }

  // After a body completes normally.
  function Walk(p: Program, body: seq<Stmt>, e: Env): Env
    decreases body, 0
  {
    if |body| == 0 then e else Walk(p, body[1..], After(p, body[0], e))
  }

  // Names a loop body may leave unbound: `run … as x · else skip`, and the
  // variables of nested loops.
  function Unbinds(body: seq<Stmt>): set<Name> {
    var flat := Flat(body);
    (set s <- flat | s.Run? && s.binding.Some? && s.els.Skip? :: s.binding.value)
    + (set s <- flat | s.ForEach? :: s.loopVar)
  }

  // Every kind a loop body may bind x to.
  function BodyKinds(p: Program, body: seq<Stmt>, x: Name): set<Kind> {
    var flat := Flat(body);
    (set s, k | s in flat && Binding(s) == Some(x) && k in BindKinds(s) :: k)
    + (set s, k | s in flat && s.ForEach? && s.loopVar == x && k in ItemKinds(p, s.list) :: k)
  }

  function BodyNames(body: seq<Stmt>): set<Name> {
    var flat := Flat(body);
    (set s <- flat | Binding(s).Some? :: Binding(s).value)
    + (set s <- flat | s.ForEach? :: s.loopVar)
  }

  // At the start of every iteration: whatever held before the loop, less
  // what the body may unbind, plus whatever the body may bind; and the loop
  // variable holds an item.
  function LoopEntry(p: Program, s: Stmt, e: Env): Env
    requires s.ForEach?
  {
    var names := e.kinds.Keys + BodyNames(s.body);
    Env((e.bound - Unbinds(s.body)) + {s.loopVar},
        (map x | x in names :: KindsOf(e, x) + BodyKinds(p, s.body, x))[s.loopVar := ItemKinds(p, s.list)])
  }

  // After the last iteration (lists are never empty, so there is one). The
  // loop variable is unbound, even if it had a value before (SPEC §3.5).
  function LoopExit(p: Program, s: Stmt, e: Env): Env
    requires s.ForEach?
    decreases s, 0
  {
    var w := Walk(p, s.body, LoopEntry(p, s, e));
    Env(w.bound - {s.loopVar}, w.kinds - {s.loopVar})
  }

  // The safe-value check (SPEC §3.5).
  predicate SafeChar(c: char) {
    'a' <= c <= 'z' || 'A' <= c <= 'Z' || '0' <= c <= '9' || c in "._/:@%+=,-"
  }

  predicate SafeValue(v: string) {
    |v| > 0 && v[0] != '-' && forall c <- v :: SafeChar(c)
  }

  // An int param renders as its digits, so it's safe unless negative.
  predicate SafeParam(v: Param) {
    if v.PStr? then SafeValue(v.s) else v.i >= 0
  }

  predicate ValuesSafe(p: Program, id: SectionId) {
    IsData(p, id) ==> forall i <- DataList(p, id).items | i.Value? :: SafeValue(i.value)
  }

  // A value of kind k may go into a command as x: not run output, not an
  // action item, and a param default or list value passes the safe-value
  // check. (Built-ins and --param overrides are checked by the host.)
  predicate CmdKindOk(p: Program, x: Name, k: Kind) {
    !k.KRun? && !k.KAction?
    && (k == KParam ==> x in p.params && SafeParam(p.params[x]))
    && (k.KValue? ==> ValuesSafe(p, k.list))
  }

  predicate CmdVarOk(p: Program, e: Env, x: Name) {
    x in e.bound && forall k <- KindsOf(e, x) :: CmdKindOk(p, x, k)
  }

  // The names in the commands of list L's action items.
  function ActionVars(p: Program, list: SectionId): set<Name> {
    if IsData(p, list) then set i, y | i in DataList(p, list).items && i.Action? && y in PartVars(i.cmd) :: y
    else {}
  }

  function CmdVars(s: Stmt): set<Name> {
    match s
    case Run(_, cmd, _, _) => PartVars(cmd)
    case Do(_, DoCmd(cmd), _) => PartVars(cmd)
    case Check(_, Succeeds(cmd), _, _) => PartVars(cmd)
    case IfYesRun(_, cmd, _) => PartVars(cmd)
    case IfYesDo(_, DoCmd(cmd), _) => PartVars(cmd)
    case _ => {}
  }

  function OperandVars(s: Stmt): set<Name> {
    if s.Check? && s.cond.Cmp? then
      (if s.cond.l.VarOp? then {s.cond.l.name} else {}) + (if s.cond.r.VarOp? then {s.cond.r.name} else {})
    else {}
  }

  // `do step`: the item must be a loop variable over action items.
  function DoItems(s: Stmt): set<Name> {
    if (s.Do? || s.IfYesDo?) && s.action.DoItem? then {s.action.item} else {}
  }

  // May s (or, for a loop, anything in it) bind x?
  predicate MayBind(s: Stmt, x: Name) {
    x in BindingSet(s) || (s.ForEach? && (x == s.loopVar || x in BodyNames(s.body)))
  }

  // The name of the nearest preceding yes/no ask in the same list, which
  // governs `if yes` (SPEC §4.2). Anything that may rebind that name in
  // between leaves no governing answer.
  function NextGov(s: Stmt, gov: Option<Name>): Option<Name> {
    if s.Ask? && s.form.YesNo? then Some(s.form.binding)
    else if gov.Some? && MayBind(s, gov.value) then None
    else gov
  }

  // One statement, given the env `e` before it, the loop variables in
  // scope `lv`, and the governing yes/no answer `gov`. `In[id]` summarises
  // the env on entry to each section the run can reach.
  ghost predicate StmtOk(p: Program, In: map<SectionId, Env>, s: Stmt, e: Env, lv: set<Name>, gov: Option<Name>)
    decreases s, 1
  {
    (forall x <- CmdVars(s) :: CmdVarOk(p, e, x))
    && (forall x <- OperandVars(s) :: x in e.bound)
    && (forall x <- DoItems(s) ::
          x in e.bound
          && forall k <- KindsOf(e, x) :: k.KAction? && forall y <- ActionVars(p, k.list) :: CmdVarOk(p, e, y))
    && ((s.IfYesRun? || s.IfYesDo?) ==> gov.Some? && gov.value in e.bound && KindsOf(e, gov.value) == {KYesNo})
    // A transfer drops the loop variables in scope, and binds nothing.
    && (forall j <- Jumps(s) :: j.ref.id in In && Approx(In[j.ref.id], Forget(e, lv + BindingSet(s))))
    && (s.ForEach? ==>
          IsData(p, s.list.id) && |DataList(p, s.list.id).items| > 0
          && SeqOk(p, In, s.body, LoopEntry(p, s, e), lv + {s.loopVar}, None))
  }

  ghost predicate SeqOk(p: Program, In: map<SectionId, Env>, body: seq<Stmt>, e: Env, lv: set<Name>, gov: Option<Name>)
    decreases body, 0
  {
    |body| == 0
    || (StmtOk(p, In, body[0], e, lv, gov)
        && SeqOk(p, In, body[1..], After(p, body[0], e), lv, NextGov(body[0], gov)))
  }

  // In covers the entry and every jump target of its sections, so it covers
  // every section a run reaches.
  ghost predicate FlowOkWith(p: Program, In: map<SectionId, Env>) {
    p.entry.section in In && Approx(In[p.entry.section], EntryEnv(p))
    && forall id | id in In :: IsInstr(p, id) && SeqOk(p, In, Body(p, id), In[id], {}, None)
  }

  ghost predicate FlowOk(p: Program) {
    exists In :: FlowOkWith(p, In)
  }

  // ---- the concrete semantics the interpreter must stay within ----

  // Each bound name, and the kind of its value.
  type CEnv = map<Name, Kind>

  // The abstract env A describes the concrete c.
  predicate Holds(a: Env, c: CEnv) {
    a.bound <= c.Keys && forall x | x in c :: x in a.kinds && c[x] in a.kinds[x]
  }

  // A run starts with its params and built-ins (a param wins a clash).
  function Initial(p: Program): CEnv {
    map x | x in p.params.Keys + Builtins :: if x in p.params then KParam else KBuiltin
  }

  // s finishes and the run carries on to the next instruction (SPEC §4.2,
  // §4.3). A failed `run … as x · else skip` leaves x unbound.
  ghost predicate Completes(p: Program, s: Stmt, c: CEnv, c': CEnv)
    decreases s, 2
  {
    match s
    case Run(_, _, b, els) =>
      if b.None? then c' == c else c' == c[b.value := KRun] || (els.Skip? && c' == c - {b.value})
    case Do(_, _, _) => c' == c
    // True continues only without a target; false only without else [X].
    case Check(_, _, onTrue, els) => (onTrue.None? || !els.ElseTo?) && c' == c
    case Ask(_, _, _, form, _) =>
      (match form
       case Sections(_) => false
       case YesNo(x) => c' == c[x := KYesNo]
       case OneOf(l, x) => IsData(p, l.id) && c' == c[x := KValue(l.id)]
       case Score(_, _, _, x) => c' == c[x := KScore])
    // Once per item, in order; then the loop variable is unbound.
    case ForEach(_, v, l, _) =>
      IsData(p, l.id) && exists cn :: Iterates(p, s, DataList(p, l.id).items, c, cn) && c' == cn - {v}
    case IfYesRun(_, _, _) => c' == c
    case IfYesDo(_, _, _) => c' == c
    case Then(_, _) => false
    case Page(_, _) => false
    case HandOff(_) => false
    case Stop(_) => false
  }

  ghost predicate Iterates(p: Program, s: Stmt, items: seq<Item>, c: CEnv, c': CEnv)
    requires s.ForEach?
    decreases s, 1, |items|
  {
    if |items| == 0 then c' == c
    // The variable holds an action item or a value item from the list.
    else exists d :: SeqCompletes(p, s.body, c[s.loopVar := if items[0].Action? then KAction(s.list.id) else KValue(s.list.id)], d)
                     && Iterates(p, s, items[1..], d, c')
  }

  ghost predicate SeqCompletes(p: Program, body: seq<Stmt>, c: CEnv, c': CEnv)
    decreases body, 0
  {
    if |body| == 0 then c' == c
    else exists m :: Completes(p, body[0], c, m) && SeqCompletes(p, body[1..], m, c')
  }

  // Leaving by one of s's jumps: the loop variables in scope are dropped,
  // and a name s would have bound may be unbound; nothing else changes.
  predicate TransferEnv(s: Stmt, c: CEnv, lv: set<Name>, c': CEnv) {
    c.Keys - lv - BindingSet(s) <= c'.Keys <= c.Keys - lv
    && forall x | x in c' :: c'[x] == c[x]
  }

  // What the interpreter may rely on before running s in the env c. A
  // name in a command is never run output or an action item (P4), stated
  // here directly as well as through CmdKindOk.
  ghost predicate SafeAt(p: Program, s: Stmt, c: CEnv, gov: Option<Name>) {
    (forall x <- CmdVars(s) :: InCmd(p, c, x))
    && (forall x <- OperandVars(s) :: x in c)
    && (forall x <- DoItems(s) :: x in c && c[x].KAction? && forall y <- ActionVars(p, c[x].list) :: InCmd(p, c, y))
    && ((s.IfYesRun? || s.IfYesDo?) ==> gov.Some? && gov.value in c && c[gov.value] == KYesNo)
  }

  ghost predicate InCmd(p: Program, c: CEnv, x: Name) {
    x in c && c[x] != KRun && !c[x].KAction? && CmdKindOk(p, x, c[x])
  }

  // ---- the simulation lemmas ----

  lemma EntrySim(p: Program)
    ensures Holds(EntryEnv(p), Initial(p))
  {}

  lemma HoldsApprox(a: Env, b: Env, c: CEnv)
    requires Approx(a, b) && Holds(b, c)
    ensures Holds(a, c)
  {}

  lemma StmtSim(p: Program, In: map<SectionId, Env>, s: Stmt, a: Env, lv: set<Name>, gov: Option<Name>, c: CEnv)
    requires StmtOk(p, In, s, a, lv, gov) && Holds(a, c)
    ensures SafeAt(p, s, c, gov)
    ensures forall c' | Completes(p, s, c, c') :: Holds(After(p, s, a), c')
    ensures forall c', j | TransferEnv(s, c, lv, c') && j in Jumps(s) :: Holds(In[j.ref.id], c')
    decreases s, 2
  {
    forall x | x in CmdVars(s) ensures InCmd(p, c, x) {
      assert c[x] in KindsOf(a, x);
    }
    forall x | x in DoItems(s) ensures x in c && c[x].KAction? && forall y <- ActionVars(p, c[x].list) :: InCmd(p, c, y) {
      assert c[x] in KindsOf(a, x);
      forall y | y in ActionVars(p, c[x].list) ensures InCmd(p, c, y) { assert c[y] in KindsOf(a, y); }
    }
    forall c', j | TransferEnv(s, c, lv, c') && j in Jumps(s) ensures Holds(In[j.ref.id], c') {
      HoldsApprox(In[j.ref.id], Forget(a, lv + BindingSet(s)), c');
    }
    if s.ForEach? {
      forall c' | Completes(p, s, c, c') ensures Holds(After(p, s, a), c') {
        var items := DataList(p, s.list.id).items;
        var cn :| Iterates(p, s, items, c, cn) && c' == cn - {s.loopVar};
        var e := LoopEntry(p, s, a);
        forall ik | ik in ItemKinds(p, s.list) ensures Holds(e, c[s.loopVar := ik]) {
          LoopEntryFirst(p, s, a);
          HoldsApprox(e, Env(a.bound + {s.loopVar}, a.kinds[s.loopVar := ItemKinds(p, s.list)]), c[s.loopVar := ik]);
        }
        IterSim(p, In, s, a, lv, items, c, cn);
      }
    }
  }

  // Every iteration starts in an env LoopEntry describes, and after at
  // least one, the loop's Walk describes the result.
  lemma IterSim(p: Program, In: map<SectionId, Env>, s: Stmt, a: Env, lv: set<Name>, items: seq<Item>, c: CEnv, c': CEnv)
    requires s.ForEach? && IsData(p, s.list.id)
    requires SeqOk(p, In, s.body, LoopEntry(p, s, a), lv + {s.loopVar}, None)
    requires forall i <- items :: i in DataList(p, s.list.id).items
    requires forall ik | ik in ItemKinds(p, s.list) :: Holds(LoopEntry(p, s, a), c[s.loopVar := ik])
    requires |items| > 0 && Iterates(p, s, items, c, c')
    ensures Holds(Walk(p, s.body, LoopEntry(p, s, a)), c')
    decreases s, 1, |items|
  {
    var e := LoopEntry(p, s, a);
    var w := Walk(p, s.body, e);
    var ik := ItemKind(items[0], s.list.id);
    assert items[0] in DataList(p, s.list.id).items;
    assert ik in ItemKinds(p, s.list);
    var d :| SeqCompletes(p, s.body, c[s.loopVar := ik], d) && Iterates(p, s, items[1..], d, c');
    SeqSim(p, In, s.body, e, lv + {s.loopVar}, None, c[s.loopVar := ik], d);
    if |items| > 1 {
      forall ik' | ik' in ItemKinds(p, s.list) ensures Holds(e, d[s.loopVar := ik']) {
        LoopEntryAgain(p, s, a);
        HoldsApprox(e, Env(w.bound + {s.loopVar}, w.kinds[s.loopVar := ItemKinds(p, s.list)]), d[s.loopVar := ik']);
      }
      IterSim(p, In, s, a, lv, items[1..], d, c');
    }
  }

  lemma SeqSim(p: Program, In: map<SectionId, Env>, body: seq<Stmt>, a: Env, lv: set<Name>, gov: Option<Name>, c: CEnv, c': CEnv)
    requires SeqOk(p, In, body, a, lv, gov) && Holds(a, c) && SeqCompletes(p, body, c, c')
    ensures Holds(Walk(p, body, a), c')
    decreases body, 0
  {
    if |body| > 0 {
      var m :| Completes(p, body[0], c, m) && SeqCompletes(p, body[1..], m, c');
      StmtSim(p, In, body[0], a, lv, gov, c);
      SeqSim(p, In, body[1..], After(p, body[0], a), lv, NextGov(body[0], gov), m, c');
    }
  }

  // A terminal statement never completes, so a section body never just ends.
  lemma TerminalNeverCompletes(p: Program, s: Stmt, c: CEnv, c': CEnv)
    requires Terminal(s)
    requires forall t <- Flat([s]) | t.ForEach? :: IsData(p, t.list.id) && |DataList(p, t.list.id).items| > 0
    ensures !Completes(p, s, c, c')
    decreases s, 1
  {
    if s.ForEach? && Completes(p, s, c, c') {
      assert Flat([s]) == [s] + Flat(s.body);
      var items := DataList(p, s.list.id).items;
      assert IsData(p, s.list.id) && exists cn :: Iterates(p, s, items, c, cn) && c' == cn - {s.loopVar};
      var cn :| Iterates(p, s, items, c, cn);
      assert s in Flat([s]);
      assert |items| > 0;
      var d :| SeqCompletes(p, s.body, c[s.loopVar := ItemKind(items[0], s.list.id)], d);
      SeqNeverCompletes(p, s.body, c[s.loopVar := ItemKind(items[0], s.list.id)], d);
    }
  }

  lemma SeqNeverCompletes(p: Program, body: seq<Stmt>, c: CEnv, c': CEnv)
    requires |body| > 0 && Terminal(body[|body| - 1])
    requires forall t <- Flat(body) | t.ForEach? :: IsData(p, t.list.id) && |DataList(p, t.list.id).items| > 0
    ensures !SeqCompletes(p, body, c, c')
    decreases body, 0
  {
    if SeqCompletes(p, body, c, c') {
      FlatSplit(body);
      assert SeqCompletes(p, body, c, c') <==> exists m :: Completes(p, body[0], c, m) && SeqCompletes(p, body[1..], m, c');
      var m :| Completes(p, body[0], c, m) && SeqCompletes(p, body[1..], m, c');
      if |body| == 1 {
        assert Flat([body[0]]) == [body[0]] + (if body[0].ForEach? then Flat(body[0].body) else []);
        TerminalNeverCompletes(p, body[0], c, m);
      } else {
        SeqNeverCompletes(p, body[1..], m, c');
      }
    }
  }

  lemma NeverFallsOff(p: Program, id: SectionId, c: CEnv, c': CEnv)
    requires RefsOk(p) && ListsOk(p) && Structured(p) && IsInstr(p, id)
    ensures !SeqCompletes(p, Body(p, id), c, c')
  {
    forall t | t in Flat(Body(p, id)) && t.ForEach? ensures IsData(p, t.list.id) && |DataList(p, t.list.id).items| > 0 {
      assert t in Stmts(p);
      assert t.list in ListRefs(t);
    }
    SeqNeverCompletes(p, Body(p, id), c, c');
  }

  // ---- the loop rules are stable ----

  lemma ApproxTrans(a: Env, b: Env, c: Env)
    requires Approx(a, b) && Approx(b, c)
    ensures Approx(a, c)
  {}

  // The first iteration starts with the loop variable bound to an item, and
  // LoopEntry summarises that.
  lemma LoopEntryFirst(p: Program, s: Stmt, e: Env)
    requires s.ForEach?
    ensures Approx(LoopEntry(p, s, e), Env(e.bound + {s.loopVar}, e.kinds[s.loopVar := ItemKinds(p, s.list)]))
  {}

  // After an iteration, rebinding the loop variable to the next item gives
  // an env LoopEntry still summarises.
  lemma LoopEntryAgain(p: Program, s: Stmt, e: Env)
    requires s.ForEach?
    ensures var w := Walk(p, s.body, LoopEntry(p, s, e));
      Approx(LoopEntry(p, s, e), Env(w.bound + {s.loopVar}, w.kinds[s.loopVar := ItemKinds(p, s.list)]))
  {
    WalkWithin(p, s.body, LoopEntry(p, s, e));
  }

  // What running a body can do to an env: unbind only Unbinds(body), and
  // bind only BodyNames(body), to kinds in BodyKinds.
  ghost predicate Within(p: Program, body: seq<Stmt>, x: Env, y: Env) {
    y.bound >= x.bound - Unbinds(body)
    && forall n | n in y.kinds :: n in x.kinds.Keys + BodyNames(body) && y.kinds[n] <= KindsOf(x, n) + BodyKinds(p, body, n)
  }

  lemma FlatSplit(body: seq<Stmt>)
    requires |body| > 0
    ensures Flat(body) == [body[0]] + (if body[0].ForEach? then Flat(body[0].body) else []) + Flat(body[1..])
  {}

  // Unbinds, BodyNames and BodyKinds only grow with a body's statements.
  lemma BodyGrows(p: Program, part: seq<Stmt>, body: seq<Stmt>)
    requires forall s <- Flat(part) :: s in Flat(body)
    ensures Unbinds(part) <= Unbinds(body) && BodyNames(part) <= BodyNames(body)
    ensures forall n :: BodyKinds(p, part, n) <= BodyKinds(p, body, n)
  {}

  lemma WalkWithin(p: Program, body: seq<Stmt>, x: Env)
    ensures Within(p, body, x, Walk(p, body, x))
    decreases body, 1
  {
    if |body| > 0 {
      FlatSplit(body);
      AfterWithin(p, body, x);
      var y := After(p, body[0], x);
      WalkWithin(p, body[1..], y);
      BodyGrows(p, body[1..], body);
    }
  }

  lemma AfterWithin(p: Program, body: seq<Stmt>, x: Env)
    requires |body| > 0
    ensures Within(p, body, x, After(p, body[0], x))
    decreases body, 0
  {
    FlatSplit(body);
    var s := body[0];
    assert s in Flat(body);
    if s.ForEach? {
      BodyGrows(p, s.body, body);
      var entry := LoopEntry(p, s, x);
      WalkWithin(p, s.body, entry);
      assert ItemKinds(p, s.list) <= BodyKinds(p, body, s.loopVar);
    } else if Binding(s).Some? {
      assert BindKinds(s) <= BodyKinds(p, body, Binding(s).value);
    }
  }
}
