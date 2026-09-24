// Semantic lint (SPEC §7.1): Lint(p) finds every lint-stage error, and
// LintSound proves a clean lint means WellFormed(p), the lint half of P6
// (SPEC §5.3). Warnings(p) finds the lint-time warnings.
//
// Each check returns a set of findings, and each has a lemma: no findings
// means its WellFormed conjunct holds. Findings are sorted by line, then
// code, once at the end.
module SkopeCheck {
  import opened SkopeAst
  import opened SkopeWellFormed
  import SkopeStep

  type LintError = SkopeStep.LintError

  function Err(code: string, src: Src): LintError {
    SkopeStep.LintError(code, src)
  }

  // Compiled comprehensions re-evaluate their ranges for every element, so
  // findings are gathered with these folds, which evaluate each part once.
  function UnionSeq<T>(xs: seq<T>, f: T -> set<LintError>): set<LintError> {
    if |xs| == 0 then {} else f(xs[0]) + UnionSeq(xs[1..], f)
  }

  lemma InUnionSeq<T>(xs: seq<T>, f: T -> set<LintError>, x: T, e: LintError)
    requires x in xs && e in f(x)
    ensures e in UnionSeq(xs, f)
  {
    if xs[0] != x { InUnionSeq(xs[1..], f, x, e); }
  }

  function OverSections(p: Program, f: SectionId -> set<LintError>): set<LintError> {
    var ids := Ids(p);
    var m := map id | id in ids :: f(id);
    set id, e | id in m && e in m[id] :: e
  }

  lemma InOverSections(p: Program, f: SectionId -> set<LintError>, id: SectionId, e: LintError)
    requires IsInstr(p, id) && e in f(id)
    ensures e in OverSections(p, f)
  {
    var m := map i | i in Ids(p) :: f(i);
    assert id in m && e in m[id];
  }

  function FlatOf(p: Program, f: Stmt -> set<LintError>): SectionId -> set<LintError> {
    id => if IsInstr(p, id) then UnionSeq(Flat(Body(p, id)), f) else {}
  }

  // The findings f gives for every statement.
  function OverStmts(p: Program, f: Stmt -> set<LintError>): set<LintError> {
    OverSections(p, FlatOf(p, f))
  }

  lemma InOverStmts(p: Program, f: Stmt -> set<LintError>, s: Stmt, e: LintError)
    requires s in Stmts(p) && e in f(s)
    ensures e in OverStmts(p, f)
  {
    var id :| id in p.sections && p.sections[id].Instructions? && s in Flat(p.sections[id].body);
    InUnionSeq(Flat(Body(p, id)), f, s, e);
    InOverSections(p, FlatOf(p, f), id, e);
  }

  function Lint(p: Program): seq<LintError> {
    Sorted(Errors(p, Analyse(p)))
  }

  function Warnings(p: Program): seq<LintError> {
    Sorted(WarningsWith(p, Analyse(p)))
  }

  // Both at once, sharing one analysis: what src/lint.ts calls.
  function LintAll(p: Program): (seq<LintError>, seq<LintError>) {
    var f := Analyse(p);
    (Sorted(Errors(p, f)), Sorted(WarningsWith(p, f)))
  }

  // What several checks share, computed once.
  datatype Facts = Facts(reach: map<SectionId, set<SectionId>>, In: map<SectionId, Env>)

  function Analyse(p: Program): Facts {
    var reach := Reaches(p);
    Facts(reach, InEnvs(p, reach))
  }

  function Errors(p: Program, f: Facts): set<LintError> {
    var cycles := CycleErrs(p, f.reach);
    var actions := ActionErrs(p);
    EntryErrs(p) + RefErrs(p) + ListErrs(p) + cycles + StructErrs(p) + ChecksErrs(p) + AskErrs(p)
    + NameErrs(p) + actions
    // Bindings flow along transfers, so they're only followed once the
    // transfer graph is known to be acyclic.
    + (if cycles == {} then FlowErrs(p, f.In, actions == {}) else {})
  }

  // Split per check, so each fact verifies on its own.
  lemma {:vcs_split_on_every_assert} LintSound(p: Program)
    ensures Lint(p) == [] ==> WellFormed(p)
  {
    if Lint(p) == [] {
      var f := Analyse(p);
      assert Errors(p, f) == {};
      assert EntryErrs(p) == {};
      assert RefErrs(p) == {};
      assert ListErrs(p) == {};
      assert CycleErrs(p, f.reach) == {};
      assert StructErrs(p) == {};
      assert ChecksErrs(p) == {};
      assert AskErrs(p) == {};
      assert NameErrs(p) == {};
      assert ActionErrs(p) == {};
      assert FlowErrs(p, f.In, true) == {};
      EntrySound(p);
      RefsSound(p);
      ListsSound(p);
      CycleSound(p);
      StructSound(p);
      ChecksSound(p);
      AsksSound(p);
      NamesSound(p);
      ActionSound(p);
      FlowSound(p, f.In);
    }
  }

  // ---- the entry ----

  function EntryErrs(p: Program): set<LintError> {
    if IsInstr(p, p.entry.section) then {}
    else if p.entry.section in p.sections then {Err("E-REF-KIND", p.entry.src)}
    else {Err("E-UNRESOLVED", p.entry.src)}
  }

  lemma EntrySound(p: Program)
    requires EntryErrs(p) == {}
    ensures EntryOk(p)
  {}

  // ---- references ----

  function TargetErrs(p: Program, r: SectionRef, src: Src): set<LintError> {
    if !AnchorOk(r) || r.id !in p.sections then {Err("E-UNRESOLVED", src)}
    else if !IsInstr(p, r.id) then {Err("E-REF-KIND", src)}
    else {}
  }

  function ListRefErrs(p: Program, r: SectionRef, src: Src): set<LintError> {
    if !AnchorOk(r) || r.id !in p.sections then {Err("E-UNRESOLVED", src)}
    else if p.sections[r.id].Instructions? then {Err("E-REF-KIND", src)}
    else if !IsData(p, r.id) then {Err("E-SECTION-KIND", src)}
    else {}
  }

  function StmtRefErrs(p: Program, s: Stmt): set<LintError> {
    var jumps := Jumps(s);
    (set j, e | j in jumps && e in TargetErrs(p, j.ref, j.src) :: e)
    + (set r, e | r in ListRefs(s) && e in ListRefErrs(p, r, s.src) :: e)
  }

  function RefErrs(p: Program): set<LintError> {
    OverStmts(p, RefsOf(p))
  }

  function RefsOf(p: Program): Stmt -> set<LintError> {
    s => StmtRefErrs(p, s)
  }

  lemma RefsSound(p: Program)
    requires RefErrs(p) == {}
    ensures RefsOk(p)
  {
    forall s | s in Stmts(p)
      ensures (forall j <- Jumps(s) :: AnchorOk(j.ref) && IsInstr(p, j.ref.id))
      ensures (forall r <- ListRefs(s) :: AnchorOk(r) && IsData(p, r.id))
    {
      forall j | j in Jumps(s) ensures AnchorOk(j.ref) && IsInstr(p, j.ref.id) {
        var errs := TargetErrs(p, j.ref, j.src);
        if errs != {} { var e :| e in errs; InOverStmts(p, RefsOf(p), s, e); }
      }
      forall r | r in ListRefs(s) ensures AnchorOk(r) && IsData(p, r.id) {
        var errs := ListRefErrs(p, r, s.src);
        if errs != {} { var e :| e in errs; assert e in StmtRefErrs(p, s); InOverStmts(p, RefsOf(p), s, e); }
      }
    }
  }

  // ---- data lists ----

  function DataListErrs(l: List): set<LintError> {
    if |l.items| == 0 then {Err("E-LIST-EMPTY", l.src)}
    else
      (var odd := MinorityIsAction(l.items);
       if forall i <- l.items :: i.Action? == l.items[0].Action? then {}
       else set i <- l.items | i.Action? == odd :: Err("E-LIST-MIXED", i.src))
      + (set a, b | 0 <= a < b < |l.items| && Lower(Label(l.items[a])) == Lower(Label(l.items[b])) :: Err("E-LIST-DUP", l.items[b].src))
  }

  // In a mixed list, the kind fewer items have; on a tie, the kind the
  // first item doesn't have.
  function MinorityIsAction(items: seq<Item>): bool
    requires |items| > 0
  {
    var actions := |set k | 0 <= k < |items| && items[k].Action?|;
    if 2 * actions == |items| then !items[0].Action? else 2 * actions < |items|
  }

  function StmtListErrs(p: Program, s: Stmt): set<LintError> {
    (if s.ForEach? && IsData(p, s.list.id) then DataListErrs(DataList(p, s.list.id))
     else if s.Ask? && s.form.OneOf? && IsData(p, s.form.list.id) then DataListErrs(DataList(p, s.form.list.id))
     else {})
    + (if s.Ask? && s.form.OneOf? && IsData(p, s.form.list.id) && exists i <- DataList(p, s.form.list.id).items :: i.Action?
       then {Err("E-LIST-KIND", s.src)} else {})
  }

  function ListErrs(p: Program): set<LintError> {
    OverStmts(p, ListsOf(p))
  }

  function ListsOf(p: Program): Stmt -> set<LintError> {
    s => StmtListErrs(p, s)
  }

  lemma DataListSound(l: List)
    requires DataListErrs(l) == {}
    ensures DataListOk(l)
  {
    if |l.items| > 0 {
      if exists i <- l.items :: i.Action? != l.items[0].Action? {
        var i :| i in l.items && i.Action? != l.items[0].Action?;
        var odd := if i.Action? == MinorityIsAction(l.items) then i else l.items[0];
        assert Err("E-LIST-MIXED", odd.src) in DataListErrs(l);
      }
      forall a, b | 0 <= a < b < |l.items| ensures Lower(Label(l.items[a])) != Lower(Label(l.items[b])) {
        if Lower(Label(l.items[a])) == Lower(Label(l.items[b])) { assert Err("E-LIST-DUP", l.items[b].src) in DataListErrs(l); }
      }
    }
  }

  lemma ListsSound(p: Program)
    requires ListErrs(p) == {}
    ensures ListsOk(p)
  {
    forall s | s in Stmts(p)
      ensures forall r <- ListRefs(s) | IsData(p, r.id) :: DataListOk(DataList(p, r.id))
      ensures s.Ask? && s.form.OneOf? && IsData(p, s.form.list.id) ==> forall i <- DataList(p, s.form.list.id).items :: i.Value?
    {
      forall r | r in ListRefs(s) && IsData(p, r.id) ensures DataListOk(DataList(p, r.id)) {
        if e :| e in DataListErrs(DataList(p, r.id)) { assert e in StmtListErrs(p, s); InOverStmts(p, ListsOf(p), s, e); }
        DataListSound(DataList(p, r.id));
      }
      if s.Ask? && s.form.OneOf? && IsData(p, s.form.list.id) && exists i <- DataList(p, s.form.list.id).items :: i.Action? {
        assert Err("E-LIST-KIND", s.src) in StmtListErrs(p, s);
        InOverStmts(p, ListsOf(p), s, Err("E-LIST-KIND", s.src));
      }
    }
  }

  // ---- the transfer graph ----

  function Ids(p: Program): set<SectionId> {
    set id | id in p.sections && p.sections[id].Instructions?
  }

  // The instruction sections a section transfers to.
  function Succ(p: Program, id: SectionId): set<SectionId>
    requires IsInstr(p, id)
  {
    var jumps := AllJumps(Flat(Body(p, id)));
    set j | j in jumps && IsInstr(p, j.ref.id) :: j.ref.id
  }

  // Every statement's jumps, computed once each: compiled comprehensions
  // re-evaluate their ranges.
  function AllJumps(flat: seq<Stmt>): set<Jump> {
    if |flat| == 0 then {} else Jumps(flat[0]) + AllJumps(flat[1..])
  }

  lemma InAllJumps(flat: seq<Stmt>, s: Stmt, j: Jump)
    requires s in flat && j in Jumps(s)
    ensures j in AllJumps(flat)
  {
    if flat[0] != s { InAllJumps(flat[1..], s, j); }
  }

  function SuccMap(p: Program): map<SectionId, set<SectionId>> {
    var ids := Ids(p);
    map id | id in ids :: Succ(p, id)
  }

  // The sections reachable from v: a breadth-first search, where only
  // `frontier`'s successors can be new.
  function Closure(p: Program, succ: map<SectionId, set<SectionId>>, v: set<SectionId>, frontier: set<SectionId>): set<SectionId>
    requires succ == SuccMap(p) && frontier <= v <= Ids(p)
    decreases |Ids(p) - v|
  {
    var n := (set id, t | id in frontier && t in succ[id] :: t) - v;
    if n == {} then v
    else
      Smaller(Ids(p) - (v + n), Ids(p) - v);
      Closure(p, succ, v + n, n)
  }

  function Reach(p: Program, succ: map<SectionId, set<SectionId>>, id: SectionId): set<SectionId>
    requires succ == SuccMap(p) && IsInstr(p, id)
  {
    Closure(p, succ, {id}, {id})
  }

  lemma Smaller<T>(a: set<T>, b: set<T>)
    requires a < b
    ensures |a| < |b|
  {
    assert b == a + (b - a);
  }

  ghost predicate Closed(p: Program, c: set<SectionId>) {
    forall id | id in c && IsInstr(p, id) :: Succ(p, id) <= c
  }

  // Closure is the least closed set containing v.
  lemma ClosureLeast(p: Program, succ: map<SectionId, set<SectionId>>, v: set<SectionId>, frontier: set<SectionId>)
    requires succ == SuccMap(p) && frontier <= v <= Ids(p)
    requires forall id | id in v - frontier :: Succ(p, id) <= v
    ensures v <= Closure(p, succ, v, frontier) && Closed(p, Closure(p, succ, v, frontier))
    ensures forall c | v <= c && Closed(p, c) :: Closure(p, succ, v, frontier) <= c
    decreases |Ids(p) - v|
  {
    var n := (set id, t | id in frontier && t in succ[id] :: t) - v;
    forall id | id in frontier ensures Succ(p, id) <= v + n {
      forall t | t in Succ(p, id) ensures t in v + n { assert t in succ[id]; }
    }
    if n != {} {
      Smaller(Ids(p) - (v + n), Ids(p) - v);
      ClosureLeast(p, succ, v + n, n);
      forall c | v <= c && Closed(p, c) ensures v + n <= c {
        forall t | t in n ensures t in c {
          var id :| id in frontier && t in succ[id];
        }
      }
    }
  }

  lemma ReachLeast(p: Program, id: SectionId)
    requires IsInstr(p, id)
    ensures id in Reach(p, SuccMap(p), id) && Closed(p, Reach(p, SuccMap(p), id))
    ensures forall c | id in c && Closed(p, c) :: Reach(p, SuccMap(p), id) <= c
  {
    ClosureLeast(p, SuccMap(p), {id}, {id});
  }

  // What each instruction section reaches, itself included.
  function Reaches(p: Program): map<SectionId, set<SectionId>> {
    var ids := Ids(p);
    var succ := SuccMap(p);
    map id | id in ids :: Reach(p, succ, id)
  }

  // A transfer is on a cycle when its source is reachable from its target.
  function CycleErrs(p: Program, reach: map<SectionId, set<SectionId>>): set<LintError> {
    var jumps := SectionJumps(p);
    set id, j | id in jumps && j in jumps[id] && j.ref.id in reach && id in reach[j.ref.id] :: Err("E-CYCLE", j.src)
  }

  function SectionJumps(p: Program): map<SectionId, set<Jump>> {
    var ids := Ids(p);
    map id | id in ids :: AllJumps(Flat(Body(p, id)))
  }

  // The rank that witnesses Acyclic: how many sections are reachable.
  function Ranks(reach: map<SectionId, set<SectionId>>): map<SectionId, nat> {
    map id | id in reach :: |reach[id]|
  }

  lemma CycleSound(p: Program)
    requires CycleErrs(p, Reaches(p)) == {}
    ensures Acyclic(p)
  {
    var reach := Reaches(p);
    var rank := Ranks(reach);
    forall id, s, j | IsInstr(p, id) && s in Flat(Body(p, id)) && j in Jumps(s) && IsInstr(p, j.ref.id)
      ensures rank[j.ref.id] < rank[id]
    {
      var t := j.ref.id;
      assert id in Ids(p) && t in Ids(p);
      InAllJumps(Flat(Body(p, id)), s, j);
      assert j in SectionJumps(p)[id];
      if id in reach[t] { assert Err("E-CYCLE", j.src) in CycleErrs(p, reach); }
      ReachLeast(p, id);
      ReachLeast(p, t);
      assert t in Succ(p, id);
      Smaller(reach[t], reach[id]);
    }
    assert Ranked(p, rank);
  }

  // ---- every path ends, every instruction runs ----

  function DeadErrs(body: seq<Stmt>): set<LintError> {
    set i | 0 <= i < |body| - 1 && Terminal(body[i]) :: Err("E-UNREACHABLE", body[i + 1].src)
  }

  function SectionStructErrs(src: Src, body: seq<Stmt>): set<LintError> {
    (if |body| == 0 then {Err("E-FALLS-OFF", src)}
     else if !Terminal(body[|body| - 1]) then {Err("E-FALLS-OFF", body[|body| - 1].src)}
     else {})
    + DeadErrs(body)
    + UnionSeq(Flat(body), LoopDead)
  }

  function LoopDead(s: Stmt): set<LintError> {
    if s.ForEach? then DeadErrs(s.body) else {}
  }

  function StructErrs(p: Program): set<LintError> {
    OverSections(p, StructOf(p))
  }

  function StructOf(p: Program): SectionId -> set<LintError> {
    id => if IsInstr(p, id) then SectionStructErrs(p.sections[id].src, Body(p, id)) else {}
  }

  lemma DeadSound(body: seq<Stmt>)
    requires DeadErrs(body) == {}
    ensures NoDeadCode(body)
  {
    forall i | 0 <= i < |body| - 1 ensures !Terminal(body[i]) {
      if Terminal(body[i]) { assert Err("E-UNREACHABLE", body[i + 1].src) in DeadErrs(body); }
    }
  }

  lemma StructSound(p: Program)
    requires StructErrs(p) == {}
    ensures Structured(p)
  {
    forall id | IsInstr(p, id)
      ensures |Body(p, id)| > 0 && Terminal(Body(p, id)[|Body(p, id)| - 1])
      ensures NoDeadCode(Body(p, id))
      ensures forall s <- Flat(Body(p, id)) | s.ForEach? :: NoDeadCode(s.body)
    {
      var errs := SectionStructErrs(p.sections[id].src, Body(p, id));
      if e :| e in errs { InOverSections(p, StructOf(p), id, e); }
      DeadSound(Body(p, id));
      forall s | s in Flat(Body(p, id)) && s.ForEach? ensures NoDeadCode(s.body) {
        if e :| e in DeadErrs(s.body) { InUnionSeq(Flat(Body(p, id)), LoopDead, s, e); assert e in errs; }
        DeadSound(s.body);
      }
    }
  }

  // ---- checks ----

  function CheckFindings(s: Stmt): set<LintError> {
    if s.Check? && s.onTrue.None? && s.els.NoElse? then {Err("E-GRAMMAR", s.src)} else {}
  }

  function ChecksErrs(p: Program): set<LintError> {
    OverStmts(p, CheckFindings)
  }

  lemma ChecksSound(p: Program)
    requires ChecksErrs(p) == {}
    ensures ChecksOk(p)
  {
    forall s | s in Stmts(p) && s.Check? ensures s.onTrue.Some? || !s.els.NoElse? {
      if s.onTrue.None? && s.els.NoElse? { InOverStmts(p, CheckFindings, s, Err("E-GRAMMAR", s.src)); }
    }
  }

  // ---- ask forms ----

  function RubricErrs(src: Src, low: int, high: int, rubric: seq<RubricLine>): set<LintError> {
    (set r <- rubric | !(low <= r.level <= high) :: Err("E-SCORE-RUBRIC", r.src))
    + (set a, b | 0 <= a < b < |rubric| && rubric[a].level == rubric[b].level :: Err("E-SCORE-RUBRIC", rubric[b].src))
    + (set level | low <= level <= high && level !in Levels(rubric) :: Err("E-SCORE-RUBRIC", src))
  }

  function AskErrsOf(s: Stmt): set<LintError>
    requires s.Ask?
  {
    (if s.els.Skip? && !s.form.YesNo? then {Err("E-ELSE-SKIP", s.src)} else {})
    + match s.form
      case Sections(opts) =>
        (if |opts| < 2 || |opts| > 255 then {Err("E-OPTION-COUNT", s.src)} else {})
        + (set a, b | 0 <= a < b < |opts| && opts[a].ref.id == opts[b].ref.id :: Err("E-OPTION-COUNT", opts[b].src))
      case Score(low, high, rubric, _) =>
        if !(0 <= low < high && high - low < 10) then {Err("E-SCORE-RANGE", s.src)}
        else RubricErrs(s.src, low, high, rubric)
      case _ => {}
  }

  function AskErrs(p: Program): set<LintError> {
    OverStmts(p, AskFindings)
  }

  function AskFindings(s: Stmt): set<LintError> {
    if s.Ask? then AskErrsOf(s) else {}
  }

  lemma AskSound(s: Stmt)
    requires s.Ask? && AskErrsOf(s) == {}
    ensures AskOk(s)
  {
    match s.form
    case Sections(opts) =>
      forall a, b | 0 <= a < b < |opts| ensures opts[a].ref.id != opts[b].ref.id {
        if opts[a].ref.id == opts[b].ref.id { assert Err("E-OPTION-COUNT", opts[b].src) in AskErrsOf(s); }
      }
    case Score(low, high, rubric, _) =>
      forall r | r in rubric ensures low <= r.level <= high {
        if !(low <= r.level <= high) { assert Err("E-SCORE-RUBRIC", r.src) in AskErrsOf(s); }
      }
      forall a, b | 0 <= a < b < |rubric| ensures rubric[a].level != rubric[b].level {
        if rubric[a].level == rubric[b].level { assert Err("E-SCORE-RUBRIC", rubric[b].src) in AskErrsOf(s); }
      }
      forall level | low <= level <= high ensures level in Levels(rubric) {
        if level !in Levels(rubric) { assert Err("E-SCORE-RUBRIC", s.src) in AskErrsOf(s); }
      }
    case _ =>
  }

  lemma AsksSound(p: Program)
    requires AskErrs(p) == {}
    ensures AsksOk(p)
  {
    forall s | s in Stmts(p) && s.Ask? ensures AskOk(s) {
      if e :| e in AskErrsOf(s) { InOverStmts(p, AskFindings, s, e); }
      AskSound(s);
    }
  }

  // ---- names never bound anywhere ----

  function NameErrs(p: Program): set<LintError> {
    var all := AllNames(p);
    var stmts := Stmts(p);
    set s, x | s in stmts && x in TextVars(s) && x !in all :: Err("E-UNBOUND", s.src)
  }

  lemma NamesSound(p: Program)
    requires NameErrs(p) == {}
    ensures NamesKnown(p)
  {
    forall s | s in Stmts(p) ensures TextVars(s) <= AllNames(p) {
      forall x | x in TextVars(s) ensures x in AllNames(p) {
        if x !in AllNames(p) { assert Err("E-UNBOUND", s.src) in NameErrs(p); }
      }
    }
  }

  // ---- action-item commands ----

  // At the item's line: a name bound nowhere is E-UNBOUND, a rebound one
  // E-TAINT; an unsafe param default is E-UNSAFE-VALUE at the default.
  function ActionVarErrs(p: Program, rebound: set<Name>, y: Name, src: Src): set<LintError> {
    if y !in p.params.Keys + Builtins then {Err(if y in rebound then "E-TAINT" else "E-UNBOUND", src)}
    else if y in rebound then {Err("E-TAINT", src)}
    else if y in p.params && !SafeParam(p.params[y]) then {Err("E-UNSAFE-VALUE", p.params[y].src)}
    else {}
  }

  function ActionFindings(p: Program, rebound: set<Name>): Stmt -> set<LintError> {
    (s: Stmt) => if s.ForEach? && IsData(p, s.list.id)
         then set i, y, e | i in DataList(p, s.list.id).items && i.Action? && y in PartVars(i.cmd)
                            && e in ActionVarErrs(p, rebound, y, i.src) :: e
         else {}
  }

  function ActionErrs(p: Program): set<LintError> {
    OverStmts(p, ActionFindings(p, Rebound(p)))
  }

  lemma ActionSound(p: Program)
    requires ActionErrs(p) == {}
    ensures ActionCmdsOk(p)
  {
    var rebound := Rebound(p);
    forall s, i, y | s in Stmts(p) && s.ForEach? && IsData(p, s.list.id) && i in DataList(p, s.list.id).items
                     && i.Action? && y in PartVars(i.cmd)
      ensures y in p.params.Keys + Builtins && y !in rebound && (y in p.params ==> SafeParam(p.params[y]))
    {
      var errs := ActionVarErrs(p, rebound, y, i.src);
      if e :| e in errs { InOverStmts(p, ActionFindings(p, rebound), s, e); }
    }
  }

  // ---- bound names, taint and kinds, along every path ----

  // The envs transfers carry, by target.
  type Incoming = map<SectionId, set<Env>>

  function AddIn(a: Incoming, b: Incoming): Incoming {
    map t | t in a.Keys + b.Keys :: (if t in a then a[t] else {}) + (if t in b then b[t] else {})
  }

  function Outs(p: Program, body: seq<Stmt>, e: Env, lv: set<Name>): Incoming
    decreases body
  {
    if |body| == 0 then map[]
    else
      var s := body[0];
      var jumps := Jumps(s);
      var out := Forget(e, lv + BindingSet(s));
      var targets := set j | j in jumps :: j.ref.id;
      var here := map t | t in targets :: {out};
      AddIn(AddIn(here, if s.ForEach? then Outs(p, s.body, LoopEntry(p, s, e), lv + {s.loopVar}) else map[]),
            Outs(p, body[1..], After(p, s, e), lv))
  }

  // What holds on every one of es: bound on all, any kind any allows.
  function Meet(es: set<Env>): Env {
    var names := set e, x | e in es && x in e.kinds :: x;
    Env(set e, x | e in es && x in e.bound && (forall f | f in es :: x in f.bound) :: x,
        map x | x in names :: set e, k | e in es && x in e.kinds && k in e.kinds[x] :: k)
  }

  // The env on entry to each section the entry reaches, a layer at a time:
  // a section's rank is above every section it transfers to, so its
  // predecessors are done first. Unreachable sections' transfers don't
  // count: no run takes them. Returns the envs so far, and what their
  // sections' transfers carry.
  function InLayers(p: Program, byRank: map<nat, set<SectionId>>, n: nat, k: nat): (map<SectionId, Env>, Incoming)
    decreases n + 1 - k
  {
    if k > n then (map[], map[])
    else
      var (done, incoming) := InLayers(p, byRank, n, k + 1);
      if k !in byRank then (done, incoming)
      else
      var layer := map t | t in byRank[k] ::
        var es := (if t in incoming then incoming[t] else {}) + (if t == p.entry.section then {EntryEnv(p)} else {});
        if es == {} then EntryEnv(p) else Meet(es);
      var outsOf := map t | t in layer && IsInstr(p, t) :: Outs(p, Body(p, t), layer[t], {});
      var targets := set u, t | u in outsOf && t in outsOf[u] :: t;
      var more := map t | t in targets :: set u, e | u in outsOf && t in outsOf[u] && e in outsOf[u][t] :: e;
      (done + layer, AddIn(incoming, more))
  }

  // The layers' order and choices aren't proved: FlowErrs checks every
  // transfer against the result.
  function InEnvs(p: Program, reach: map<SectionId, set<SectionId>>): map<SectionId, Env> {
    var live := if p.entry.section in reach then reach[p.entry.section] else {};
    var rank := map id | id in live && id in reach :: |reach[id]|;
    var ranks := set id | id in rank :: rank[id];
    var byRank := map k | k in ranks :: set id | id in rank && rank[id] == k;
    var layers := InLayers(p, byRank, |live|, 1).0;
    map id | id in live :: if id in layers then layers[id] else EntryEnv(p)
  }

  function CmdVarErrs(p: Program, e: Env, x: Name, src: Src): set<LintError> {
    var ks := KindsOf(e, x);
    (if x !in e.bound then {Err("E-UNBOUND", src)} else {})
    + (if KRun in ks then {Err("E-TAINT", src)} else {})
    + (if exists k <- ks :: k.KAction? then {Err("E-ACTION-IN-CMD", src)} else {})
    + (if KParam in ks && !(x in p.params && SafeParam(p.params[x]))
       then {Err("E-UNSAFE-VALUE", if x in p.params then p.params[x].src else src)} else {})
    + (set k, i | k in ks && k.KValue? && IsData(p, k.list) && i in DataList(p, k.list).items && i.Value? && !SafeValue(i.value)
         :: Err("E-UNSAFE-VALUE", i.src))
  }

  // The transfer checks can't fail when `In` comes from InEnvs, since each
  // target's env is the meet of what its transfers carry. They're checked
  // anyway, so the proof needn't follow the layering.
  function StmtErrs(p: Program, act: bool, In: map<SectionId, Env>, s: Stmt, e: Env, lv: set<Name>, gov: Option<Name>): set<LintError>
    decreases s, 1
  {
    (set x, err | x in CmdVars(s) && err in CmdVarErrs(p, e, x, s.src) :: err)
    + (set x | x in OperandVars(s) && x !in e.bound :: Err("E-UNBOUND", s.src))
    + (set x | x in DoItems(s) && x !in e.bound :: Err("E-UNBOUND", s.src))
    + (set x, k | x in DoItems(s) && k in KindsOf(e, x) && !k.KAction? :: Err("E-LIST-KIND", s.src))
    // The item's own command runs here. Checked at the item's line only
    // when ActionErrs found nothing there: it reports the same problems.
    + (set x, k, err | act && x in DoItems(s) && k in KindsOf(e, x) && k.KAction? && err in DoneCmdErrs(p, e, k.list) :: err)
    + (if (s.IfYesRun? || s.IfYesDo?) && !(gov.Some? && gov.value in e.bound && KindsOf(e, gov.value) == {KYesNo})
       then {Err("E-IF-YES", s.src)} else {})
    + (var jumps := Jumps(s); var out := Forget(e, lv + BindingSet(s));
       set j | j in jumps && j.ref.id in In && !Approx(In[j.ref.id], out) :: Err("E-UNBOUND", j.src))
    + (if !s.ForEach? then {}
       // Reported by ListErrs and RefErrs too; the same findings, so once.
       else if !IsData(p, s.list.id) then ListRefErrs(p, s.list, s.src)
       else if |DataList(p, s.list.id).items| == 0 then DataListErrs(DataList(p, s.list.id))
       else SeqErrs(p, act, In, s.body, LoopEntry(p, s, e), lv + {s.loopVar}, None))
  }

  function DoneCmdErrs(p: Program, e: Env, list: SectionId): set<LintError> {
    if IsData(p, list)
    then set i, y, err | i in DataList(p, list).items && i.Action? && y in PartVars(i.cmd) && err in CmdVarErrs(p, e, y, i.src) :: err
    else {}
  }

  function SeqErrs(p: Program, act: bool, In: map<SectionId, Env>, body: seq<Stmt>, e: Env, lv: set<Name>, gov: Option<Name>): set<LintError>
    decreases body, 0
  {
    if |body| == 0 then {}
    else StmtErrs(p, act, In, body[0], e, lv, gov) + SeqErrs(p, act, In, body[1..], After(p, body[0], e), lv, NextGov(body[0], gov))
  }

  function FlowErrs(p: Program, In: map<SectionId, Env>, act: bool): set<LintError> {
    OverSections(p, FlowOf(p, In, act))
    + (if p.entry.section in In && !Approx(In[p.entry.section], EntryEnv(p)) then {Err("E-UNBOUND", p.entry.src)} else {})
  }

  function FlowOf(p: Program, In: map<SectionId, Env>, act: bool): SectionId -> set<LintError> {
    id => if IsInstr(p, id) && id in In then SeqErrs(p, act, In, Body(p, id), In[id], {}, None) else {}
  }

  ghost predicate JumpsIn(In: map<SectionId, Env>, body: seq<Stmt>) {
    forall s <- Flat(body), j <- Jumps(s) :: j.ref.id in In
  }

  lemma FlatParts(body: seq<Stmt>)
    requires |body| > 0
    ensures forall s <- Flat(body[1..]) :: s in Flat(body)
    ensures body[0] in Flat(body)
    ensures body[0].ForEach? ==> forall s <- Flat(body[0].body) :: s in Flat(body)
  {
    assert Flat(body) == [body[0]] + (if body[0].ForEach? then Flat(body[0].body) else []) + Flat(body[1..]);
  }

  lemma StmtSound(p: Program, In: map<SectionId, Env>, s: Stmt, e: Env, lv: set<Name>, gov: Option<Name>)
    requires forall j <- Jumps(s) :: j.ref.id in In
    requires s.ForEach? ==> JumpsIn(In, s.body)
    requires StmtErrs(p, true, In, s, e, lv, gov) == {}
    ensures StmtOk(p, In, s, e, lv, gov)
    decreases s, 1
  {
    var errs := StmtErrs(p, true, In, s, e, lv, gov);
    forall x | x in CmdVars(s) ensures CmdVarOk(p, e, x) {
      if err :| err in CmdVarErrs(p, e, x, s.src) { assert err in errs; }
      CmdVarSound(p, e, x, s.src);
    }
    forall x | x in OperandVars(s) ensures x in e.bound {
      if x !in e.bound { assert Err("E-UNBOUND", s.src) in errs; }
    }
    forall x | x in DoItems(s)
      ensures x in e.bound
      ensures forall k <- KindsOf(e, x) :: k.KAction? && forall y <- ActionVars(p, k.list) :: CmdVarOk(p, e, y)
    {
      if x !in e.bound { assert Err("E-UNBOUND", s.src) in errs; }
      forall k | k in KindsOf(e, x) ensures k.KAction? && forall y <- ActionVars(p, k.list) :: CmdVarOk(p, e, y) {
        if !k.KAction? { assert Err("E-LIST-KIND", s.src) in errs; }
        else {
          forall y | y in ActionVars(p, k.list) ensures CmdVarOk(p, e, y) {
            var i :| i in DataList(p, k.list).items && i.Action? && y in PartVars(i.cmd);
            if err :| err in CmdVarErrs(p, e, y, i.src) { assert err in DoneCmdErrs(p, e, k.list); assert err in errs; }
            CmdVarSound(p, e, y, i.src);
          }
        }
      }
    }
    forall j | j in Jumps(s) ensures Approx(In[j.ref.id], Forget(e, lv + BindingSet(s))) {
      if !Approx(In[j.ref.id], Forget(e, lv + BindingSet(s))) { assert Err("E-UNBOUND", j.src) in errs; }
    }
    if s.ForEach? {
      if !IsData(p, s.list.id) {
        assert ListRefErrs(p, s.list, s.src) != {};
      } else if |DataList(p, s.list.id).items| == 0 {
        assert Err("E-LIST-EMPTY", DataList(p, s.list.id).src) in errs;
      }
      SeqSound(p, In, s.body, LoopEntry(p, s, e), lv + {s.loopVar}, None);
    }
  }

  lemma CmdVarSound(p: Program, e: Env, x: Name, src: Src)
    requires CmdVarErrs(p, e, x, src) == {}
    ensures CmdVarOk(p, e, x)
  {
    var errs := CmdVarErrs(p, e, x, src);
    if x !in e.bound { assert Err("E-UNBOUND", src) in errs; }
    forall k | k in KindsOf(e, x) ensures CmdKindOk(p, x, k) {
      if k.KRun? { assert Err("E-TAINT", src) in errs; }
      if k.KAction? { assert Err("E-ACTION-IN-CMD", src) in errs; }
      if k == KParam && !(x in p.params && SafeParam(p.params[x])) {
        assert Err("E-UNSAFE-VALUE", if x in p.params then p.params[x].src else src) in errs;
      }
      if k.KValue? && IsData(p, k.list) {
        forall i | i in DataList(p, k.list).items && i.Value? ensures SafeValue(i.value) {
          if !SafeValue(i.value) { assert Err("E-UNSAFE-VALUE", i.src) in errs; }
        }
      }
    }
  }

  lemma SeqSound(p: Program, In: map<SectionId, Env>, body: seq<Stmt>, e: Env, lv: set<Name>, gov: Option<Name>)
    requires JumpsIn(In, body)
    requires SeqErrs(p, true, In, body, e, lv, gov) == {}
    ensures SeqOk(p, In, body, e, lv, gov)
    decreases body, 0
  {
    if |body| > 0 {
      FlatParts(body);
      StmtSound(p, In, body[0], e, lv, gov);
      SeqSound(p, In, body[1..], After(p, body[0], e), lv, NextGov(body[0], gov));
    }
  }

  lemma FlowSound(p: Program, In: map<SectionId, Env>)
    requires EntryOk(p) && RefsOk(p)
    requires In == InEnvs(p, Reaches(p)) && FlowErrs(p, In, true) == {}
    ensures FlowOk(p)
  {
    var reach := Reaches(p);
    var entry := p.entry.section;
    assert entry in Ids(p);
    ReachLeast(p, entry);
    var live := reach[entry];
    forall id | id in In ensures IsInstr(p, id) && SeqOk(p, In, Body(p, id), In[id], {}, None) {
      assert id in live && id in Ids(p);
      forall s, j | s in Flat(Body(p, id)) && j in Jumps(s) ensures j.ref.id in In {
        assert s in Stmts(p);
        assert IsInstr(p, j.ref.id);
        InAllJumps(Flat(Body(p, id)), s, j);
        assert j.ref.id in Succ(p, id);
      }
      if err :| err in SeqErrs(p, true, In, Body(p, id), In[id], {}, None) { InOverSections(p, FlowOf(p, In, true), id, err); }
      SeqSound(p, In, Body(p, id), In[id], {}, None);
    }
    assert FlowOkWith(p, In);
  }

  // ---- warnings ----

  function WarningsWith(p: Program, f: Facts): set<LintError> {
    UnreachedWarns(p, f.reach) + NoGuidanceWarns(p) + ScoreWarns(p, f.reach)
    + (if CycleErrs(p, f.reach) == {} then NoContextWarns(p, f.In) else {})
  }

  // No chain of transfers from the entry reaches the section.
  function UnreachedWarns(p: Program, reach: map<SectionId, set<SectionId>>): set<LintError> {
    if p.entry.section !in reach then {}
    else
      var reached := reach[p.entry.section];
      set id | id in reach && id in p.sections && id !in reached :: Err("W-SECTION-UNREACHED", p.sections[id].src)
  }

  // A section offered as an option has no guidance to describe it. At the
  // section's heading, where the fix goes, once however many asks offer it.
  function NoGuidanceWarns(p: Program): set<LintError> {
    var stmts := Stmts(p);
    set s, o | s in stmts && s.Ask? && s.form.Sections? && o in s.form.options && IsInstr(p, o.ref.id)
               && p.sections[o.ref.id].guidance.None? :: Err("W-NO-GUIDANCE", p.sections[o.ref.id].src)
  }

  // Asks whose question names nothing that could hold run output.
  function NoContext(p: Program, body: seq<Stmt>, e: Env): set<LintError>
    decreases body
  {
    if |body| == 0 then {}
    else
      var s := body[0];
      (if s.Ask? && forall x <- PartVars(s.question) :: KRun !in KindsOf(e, x) then {Err("W-ASK-NO-CONTEXT", s.src)} else {})
      + (if s.ForEach? then NoContext(p, s.body, LoopEntry(p, s, e)) else {})
      + NoContext(p, body[1..], After(p, s, e))
  }

  function NoContextWarns(p: Program, In: map<SectionId, Env>): set<LintError> {
    OverSections(p, id => if IsInstr(p, id) && id in In then NoContext(p, Body(p, id), In[id]) else {})
  }

  // How often a statement names x.
  function Uses(s: Stmt, x: Name): nat {
    var parts := match s
      case Run(_, cmd, _, _) => cmd
      case Do(_, DoCmd(cmd), _) => cmd
      case Check(_, Succeeds(cmd), _, _) => cmd
      case Ask(_, q, _, _, _) => q
      case IfYesRun(_, cmd, _) => cmd
      case IfYesDo(_, DoCmd(cmd), _) => cmd
      case Page(_, text) => text
      case _ => [];
    multiset(parts)[Var(x)]
    + (if s.Check? && s.cond.Cmp? && s.cond.l == VarOp(x) then 1 else 0)
    + (if s.Check? && s.cond.Cmp? && s.cond.r == VarOp(x) then 1 else 0)
    + (if x in DoItems(s) then 1 else 0)
  }

  // A comparison of x with a number.
  predicate Threshold(s: Stmt, x: Name) {
    s.Check? && s.cond.Cmp?
    && ((s.cond.l == VarOp(x) && s.cond.r.Num?) || (s.cond.r == VarOp(x) && s.cond.l.Num?))
  }

  // For each Score ask, the statements that name its variable afterwards:
  // later in its section, or in any section reachable from it.
  function ScoreWarns(p: Program, reach: map<SectionId, set<SectionId>>): set<LintError> {
    OverSections(p, id => if IsInstr(p, id) && id in reach then ScoreWarnsIn(p, reach, id, Flat(Body(p, id)), 0) else {})
  }

  function ScoreWarnsIn(p: Program, reach: map<SectionId, set<SectionId>>, id: SectionId, flat: seq<Stmt>, i: nat): set<LintError>
    requires id in reach
    decreases |flat| - i
  {
    if i >= |flat| then {} else ScoreWarn(p, reach, id, flat, i) + ScoreWarnsIn(p, reach, id, flat, i + 1)
  }

  function ScoreWarn(p: Program, reach: map<SectionId, set<SectionId>>, id: SectionId, flat: seq<Stmt>, i: nat): set<LintError>
    requires id in reach && i < |flat|
  {
    var s := flat[i];
    if !(s.Ask? && s.form.Score?) then {}
    else
      var x := s.form.binding;
      var later := (set j | i < j < |flat| :: flat[j])
                   + (set t, u | t in reach[id] && t != id && IsInstr(p, t) && u in Flat(Body(p, t)) :: u);
      var users := set u | u in later && Uses(u, x) > 0;
      if users == {} then {Err("W-SCORE-UNUSED", s.src)}
      else if exists u <- users :: users == {u} && Uses(u, x) == 1 && Threshold(u, x) then {Err("W-SCORE-THRESHOLD", s.src)}
      else {}
  }

  // ---- ordering: by line, then code ----

  predicate StrLe(a: string, b: string) {
    |a| == 0 || (|b| > 0 && (a[0] < b[0] || (a[0] == b[0] && StrLe(a[1..], b[1..]))))
  }

  predicate ErrLe(a: LintError, b: LintError) {
    a.src < b.src || (a.src == b.src && StrLe(a.code, b.code))
  }

  lemma StrLeAntisym(a: string, b: string)
    requires StrLe(a, b) && StrLe(b, a)
    ensures a == b
  {}

  lemma StrLeTotal(a: string, b: string)
    ensures StrLe(a, b) || StrLe(b, a)
  {}

  lemma StrLeTrans(a: string, b: string, c: string)
    requires StrLe(a, b) && StrLe(b, c)
    ensures StrLe(a, c)
  {}

  lemma HasLeast(s: set<LintError>)
    requires s != {}
    ensures exists m :: m in s && forall x | x in s :: ErrLe(m, x)
  {
    var y :| y in s;
    StrLeTotal(y.code, y.code);
    if s != {y} {
      HasLeast(s - {y});
      var m :| m in s - {y} && forall x | x in s - {y} :: ErrLe(m, x);
      StrLeTotal(m.code, y.code);
      if !ErrLe(m, y) {
        forall x | x in s ensures ErrLe(y, x) {
          if x != y {
            assert x in s - {y};
            if x.src == m.src == y.src { StrLeTrans(y.code, m.code, x.code); }
          }
        }
      }
    }
  }

  // ponytail: selection sort, cubic in compiled code (every `x in s` is a
  // linear scan); fine for real skills, a few seconds at ~250 findings.
  // Replace with a merge sort `by method` if skills get that big.
  function Sorted(s: set<LintError>): (r: seq<LintError>)
    ensures s != {} ==> r != []
    decreases |s|
  {
    if s == {} then []
    else
      HasLeast(s);
      forall a, b | ErrLe(a, b) && ErrLe(b, a) ensures a == b { StrLeAntisym(a.code, b.code); }
      var m :| m in s && forall x | x in s :: ErrLe(m, x);
      [m] + Sorted(s - {m})
  }
}
