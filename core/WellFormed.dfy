// What a clean lint guarantees the interpreter (SPEC §5.3 P6). SkopCheck
// proves Lint(p) == [] ==> WellFormed(p), so the interpreter can require
// WellFormed(p) and never meet a missing section or list, an unbound name,
// or a value of the wrong kind.
//
// Each conjunct covers one family of SPEC §7.1 lint codes, named beside it.
module SkopWellFormed {
  import opened SkopAst

  ghost predicate WellFormed(p: Program) {
    EntryOk(p)        // E-UNRESOLVED, E-REF-KIND (at the entry line)
    && RefsOk(p)      // E-UNRESOLVED, E-REF-KIND, E-SECTION-KIND
    && ListsOk(p)     // E-LIST-EMPTY, E-LIST-MIXED, E-LIST-DUP, E-LIST-KIND (one of)
    && Acyclic(p)     // E-CYCLE
    && Structured(p)  // E-FALLS-OFF, E-UNREACHABLE
    && AsksOk(p)      // E-OPTION-COUNT, E-ELSE-SKIP, E-SCORE-RANGE, E-SCORE-RUBRIC
    && NamesKnown(p)  // E-UNBOUND (a question or page names something never bound)
    && FlowOk(p)      // E-UNBOUND, E-TAINT, E-ACTION-IN-CMD, E-UNSAFE-VALUE, E-IF-YES, E-LIST-KIND (do item)
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
      (if form.Sections? then set o <- form.options :: Jump(o.ref, o.src) else {}) + ElseJump(els, src)
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

  // ponytail: ASCII case folding only; use full Unicode folding if labels
  // outside ASCII turn up.
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

  // Every way out of it ends the run or transfers.
  predicate Terminal(s: Stmt) {
    s.Then? || s.Page? || s.HandOff? || s.Stop?
    || (s.Ask? && s.form.Sections?)
    || (s.Check? && s.onTrue.Some? && s.els.ElseTo?)
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

  // Every name the program can bind anywhere, loop variables included.
  function AllNames(p: Program): set<Name> {
    var stmts := Stmts(p);
    p.params.Keys + Builtins
    + (set s <- stmts | Binding(s).Some? :: Binding(s).value)
    + (set s <- stmts | s.ForEach? :: s.loopVar)
  }

  // Names in question and page text. They may be unbound on some path
  // (they render as "(unavailable)"), but not on every path.
  function TextVars(s: Stmt): set<Name> {
    if s.Ask? then PartVars(s.question) else if s.Page? then PartVars(s.text) else {}
  }

  ghost predicate NamesKnown(p: Program) {
    forall s <- Stmts(p) :: TextVars(s) <= AllNames(p)
  }

  // ---- bound names, taint and kinds, along every path (SPEC §3.5) ----

  // Where a value may have come from. A list value carries its list, so the
  // safe-value check knows which items can reach a command.
  datatype Kind = KParam | KBuiltin | KRun | KValue(list: SectionId) | KAction | KYesNo | KScore

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

  // What a loop variable over [r] holds.
  function ItemKinds(p: Program, r: SectionRef): set<Kind> {
    if IsData(p, r.id) then set i <- DataList(p, r.id).items :: if i.Action? then KAction else KValue(r.id)
    else {}
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
      if s.Run? && s.els.Skip? then Env(e.bound - {x}, e.kinds[x := KindsOf(e, x) + {KRun}])
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
  // loop variable goes out of scope; any outer binding of its name may be
  // restored, so its kinds are kept.
  function LoopExit(p: Program, s: Stmt, e: Env): Env
    requires s.ForEach?
    decreases s, 0
  {
    var w := Walk(p, s.body, LoopEntry(p, s, e));
    Env(w.bound - {s.loopVar}, w.kinds[s.loopVar := KindsOf(w, s.loopVar) + KindsOf(e, s.loopVar)])
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

  // A name in a command: bound, not run output, not an action item, and
  // every param default and list value it may hold passes the safe-value
  // check. (Built-ins and --param overrides are checked by the host.)
  predicate CmdVarOk(p: Program, e: Env, x: Name) {
    x in e.bound
    && KRun !in KindsOf(e, x)
    && KAction !in KindsOf(e, x)
    && (KParam in KindsOf(e, x) ==> x in p.params && SafeParam(p.params[x]))
    && forall k <- KindsOf(e, x) | k.KValue? :: ValuesSafe(p, k.list)
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

  // The name of the nearest preceding yes/no ask in the same list, which
  // governs `if yes` (SPEC §4.2).
  function NextGov(s: Stmt, gov: Option<Name>): Option<Name> {
    if s.Ask? && s.form.YesNo? then Some(s.form.binding) else gov
  }

  // One statement, given the env `e` before it, the loop variables in
  // scope `lv`, and the governing yes/no answer `gov`. `In[id]` summarises
  // the env on entry to each instruction section.
  ghost predicate StmtOk(p: Program, In: map<SectionId, Env>, s: Stmt, e: Env, lv: set<Name>, gov: Option<Name>)
    decreases s, 1
  {
    (forall x <- CmdVars(s) :: CmdVarOk(p, e, x))
    && (forall x <- OperandVars(s) :: x in e.bound)
    && (forall x <- DoItems(s) :: x in e.bound && KindsOf(e, x) == {KAction})
    && ((s.IfYesRun? || s.IfYesDo?) ==> gov.Some? && gov.value in e.bound && KindsOf(e, gov.value) == {KYesNo})
    // A transfer leaves the loops, and binds nothing.
    && (forall j <- Jumps(s) :: j.ref.id in In && Approx(In[j.ref.id], Forget(e, lv + BindingSet(s))))
    && (s.ForEach? ==> SeqOk(p, In, s.body, LoopEntry(p, s, e), lv + {s.loopVar}, None))
  }

  function BindingSet(s: Stmt): set<Name> {
    if Binding(s).Some? then {Binding(s).value} else {}
  }

  ghost predicate SeqOk(p: Program, In: map<SectionId, Env>, body: seq<Stmt>, e: Env, lv: set<Name>, gov: Option<Name>)
    decreases body, 0
  {
    |body| == 0
    || (StmtOk(p, In, body[0], e, lv, gov)
        && SeqOk(p, In, body[1..], After(p, body[0], e), lv, NextGov(body[0], gov)))
  }

  ghost predicate FlowOkWith(p: Program, In: map<SectionId, Env>) {
    (forall id | IsInstr(p, id) :: id in In && SeqOk(p, In, Body(p, id), In[id], {}, None))
    && p.entry.section in In && Approx(In[p.entry.section], EntryEnv(p))
  }

  ghost predicate FlowOk(p: Program) {
    exists In :: FlowOkWith(p, In)
  }

  // ---- the loop rules are stable: facts for the interpreter ----

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
  // an env LoopEntry still summarises. So LoopEntry holds at the start of
  // every iteration, and SeqOk of the body applies to each.
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
