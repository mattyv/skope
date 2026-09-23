// Semantic lint (SPEC §7.1): Lint(p) finds every lint-stage error, and
// LintSound proves a clean lint means WellFormed(p), the lint half of P6
// (SPEC §5.3). Warnings(p) finds the lint-time warnings.
//
// Each check returns a set of findings, and each has a lemma: no findings
// means its WellFormed conjunct holds. Findings are sorted by line, then
// code, once at the end.
module SkopCheck {
  import opened SkopAst
  import opened SkopWellFormed
  import SkopStep

  type LintError = SkopStep.LintError

  function Err(code: string, src: Src): LintError {
    SkopStep.LintError(code, src)
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
    Sorted(Errors(p))
  }

  function Errors(p: Program): set<LintError> {
    var cycles := CycleErrs(p);
    EntryErrs(p) + RefErrs(p) + ListErrs(p) + cycles + StructErrs(p) + AskErrs(p) + NameErrs(p)
    // Bindings flow along transfers, so they're only followed once the
    // transfer graph is known to be acyclic.
    + (if cycles == {} then FlowErrs(p) else {})
  }

  lemma LintSound(p: Program)
    ensures Lint(p) == [] ==> WellFormed(p)
  {
    if Lint(p) == [] {
      assert Errors(p) == {};
      EntrySound(p);
      RefsSound(p);
      ListsSound(p);
      CycleSound(p);
      StructSound(p);
      AsksSound(p);
      NamesSound(p);
      FlowSound(p);
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
      (set i <- l.items | i.Action? != l.items[0].Action? :: Err("E-LIST-MIXED", i.src))
      + (set a, b | 0 <= a < b < |l.items| && Lower(Label(l.items[a])) == Lower(Label(l.items[b])) :: Err("E-LIST-DUP", l.items[b].src))
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
      forall i | i in l.items ensures i.Action? == l.items[0].Action? {
        if i.Action? != l.items[0].Action? { assert Err("E-LIST-MIXED", i.src) in DataListErrs(l); }
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

  function Succs(p: Program, v: set<SectionId>): set<SectionId> {
    set id, t | id in v && IsInstr(p, id) && t in Succ(p, id) :: t
  }

  // The sections reachable from v, v included.
  function Closure(p: Program, v: set<SectionId>): set<SectionId>
    requires v <= Ids(p)
    decreases |Ids(p) - v|
  {
    var n := v + Succs(p, v);
    if n == v then v
    else
      Smaller(Ids(p) - n, Ids(p) - v);
      Closure(p, n)
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

  // Closure(p, v) is the least closed set containing v.
  lemma ClosureLeast(p: Program, v: set<SectionId>)
    requires v <= Ids(p)
    ensures v <= Closure(p, v) && Closed(p, Closure(p, v))
    ensures forall c | v <= c && Closed(p, c) :: Closure(p, v) <= c
    decreases |Ids(p) - v|
  {
    var n := v + Succs(p, v);
    if n == v {
      forall id | id in v && IsInstr(p, id) ensures Succ(p, id) <= v {
        forall t | t in Succ(p, id) ensures t in v { assert t in Succs(p, v); }
      }
    } else {
      Smaller(Ids(p) - n, Ids(p) - v);
      ClosureLeast(p, n);
      forall c | v <= c && Closed(p, c) ensures n <= c {
        forall t | t in Succs(p, v) ensures t in c {
          var id :| id in v && IsInstr(p, id) && t in Succ(p, id);
        }
      }
    }
  }

  // A transfer is on a cycle when its source is reachable from its target.
  function CycleErrs(p: Program): set<LintError> {
    var reach := Reaches(p);
    var jumps := SectionJumps(p);
    set id, j | id in jumps && j in jumps[id] && j.ref.id in reach && id in reach[j.ref.id] :: Err("E-CYCLE", j.src)
  }

  function SectionJumps(p: Program): map<SectionId, set<Jump>> {
    var ids := Ids(p);
    map id | id in ids :: AllJumps(Flat(Body(p, id)))
  }

  // What each instruction section reaches.
  function Reaches(p: Program): map<SectionId, set<SectionId>> {
    var ids := Ids(p);
    map id | id in ids :: Closure(p, {id})
  }

  // The rank that witnesses Acyclic: how many sections are reachable.
  function Ranks(p: Program): map<SectionId, nat> {
    var reach := Reaches(p);
    map id | id in reach :: |reach[id]|
  }

  lemma CycleSound(p: Program)
    requires CycleErrs(p) == {}
    ensures Acyclic(p)
  {
    var rank := Ranks(p);
    forall id, s, j | IsInstr(p, id) && s in Flat(Body(p, id)) && j in Jumps(s) && IsInstr(p, j.ref.id)
      ensures rank[j.ref.id] < rank[id]
    {
      var t := j.ref.id;
      InAllJumps(Flat(Body(p, id)), s, j);
      assert j in SectionJumps(p)[id] && Reaches(p)[t] == Closure(p, {t});
      if id in Closure(p, {t}) { assert Err("E-CYCLE", j.src) in CycleErrs(p); }
      ClosureLeast(p, {id});
      ClosureLeast(p, {t});
      assert t in Succ(p, id);
      Smaller(Closure(p, {t}), Closure(p, {id}));
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

  // ---- bound names, taint and kinds, along every path ----

  // The env each transfer carries, with its target.
  function Outs(p: Program, body: seq<Stmt>, e: Env, lv: set<Name>): set<(SectionId, Env)>
    decreases body
  {
    if |body| == 0 then {}
    else
      var s := body[0];
      (var jumps := Jumps(s); var out := Forget(e, lv + BindingSet(s)); set j <- jumps :: (j.ref.id, out))
      + (if s.ForEach? then Outs(p, s.body, LoopEntry(p, s, e), lv + {s.loopVar}) else {})
      + Outs(p, body[1..], After(p, s, e), lv)
  }

  // What holds on every one of es: bound on all, any kind any allows.
  function Meet(es: set<Env>): Env {
    var names := set e, x | e in es && x in e.kinds :: x;
    Env(set e, x | e in es && x in e.bound && (forall f | f in es :: x in f.bound) :: x,
        map x | x in names :: set e, k | e in es && x in e.kinds && k in e.kinds[x] :: k)
  }

  // The env on entry to each section, a layer at a time: a section's rank
  // is above every section it transfers to, so its predecessors are done
  // first. A section nothing transfers to starts like the entry.
  // Returns the envs so far, and what their sections' transfers carry.
  function InLayers(p: Program, rank: map<SectionId, nat>, n: nat, k: nat): (map<SectionId, Env>, set<(SectionId, Env)>)
    decreases n + 1 - k
  {
    if k > n then (map[], {})
    else
      var (done, outs) := InLayers(p, rank, n, k + 1);
      var layer := map t | t in rank && rank[t] == k ::
        var es := (set o | o in outs && o.0 == t :: o.1) + (if t == p.entry.section then {EntryEnv(p)} else {});
        if es == {} then EntryEnv(p) else Meet(es);
      var more := set t, o | t in layer && IsInstr(p, t) && o in Outs(p, Body(p, t), layer[t], {}) :: o;
      (done + layer, outs + more)
  }

  function InEnvs(p: Program): map<SectionId, Env> {
    var layers := InLayers(p, Ranks(p), |Ids(p)|, 1).0;
    map id | id in Ids(p) :: if id in layers then layers[id] else EntryEnv(p)
  }

  function CmdVarErrs(p: Program, e: Env, x: Name, src: Src): set<LintError> {
    var ks := KindsOf(e, x);
    (if x !in e.bound then {Err("E-UNBOUND", src)} else {})
    + (if KRun in ks then {Err("E-TAINT", src)} else {})
    + (if KAction in ks then {Err("E-ACTION-IN-CMD", src)} else {})
    + (if KParam in ks && !(x in p.params && SafeParam(p.params[x]))
       then {Err("E-UNSAFE-VALUE", if x in p.params then p.params[x].src else src)} else {})
    + (set k, i | k in ks && k.KValue? && IsData(p, k.list) && i in DataList(p, k.list).items && i.Value? && !SafeValue(i.value)
         :: Err("E-UNSAFE-VALUE", i.src))
  }

  // The transfer checks can't fail when `In` comes from InEnvs, since each
  // target's env is the meet of what its transfers carry. They're checked
  // anyway, so the proof needn't follow the layering.
  function StmtErrs(p: Program, In: map<SectionId, Env>, s: Stmt, e: Env, lv: set<Name>, gov: Option<Name>): set<LintError>
    decreases s, 1
  {
    (set x, err | x in CmdVars(s) && err in CmdVarErrs(p, e, x, s.src) :: err)
    + (set x | x in OperandVars(s) && x !in e.bound :: Err("E-UNBOUND", s.src))
    + (set x | x in DoItems(s) && x !in e.bound :: Err("E-UNBOUND", s.src))
    + (set x | x in DoItems(s) && x in e.bound && KindsOf(e, x) != {KAction} :: Err("E-LIST-KIND", s.src))
    + (if (s.IfYesRun? || s.IfYesDo?) && !(gov.Some? && gov.value in e.bound && KindsOf(e, gov.value) == {KYesNo})
       then {Err("E-IF-YES", s.src)} else {})
    + (var jumps := Jumps(s); var out := Forget(e, lv + BindingSet(s));
       set j | j in jumps && j.ref.id in In && !Approx(In[j.ref.id], out) :: Err("E-UNBOUND", j.src))
    + (if s.ForEach? then SeqErrs(p, In, s.body, LoopEntry(p, s, e), lv + {s.loopVar}, None) else {})
  }

  function SeqErrs(p: Program, In: map<SectionId, Env>, body: seq<Stmt>, e: Env, lv: set<Name>, gov: Option<Name>): set<LintError>
    decreases body, 0
  {
    if |body| == 0 then {}
    else StmtErrs(p, In, body[0], e, lv, gov) + SeqErrs(p, In, body[1..], After(p, body[0], e), lv, NextGov(body[0], gov))
  }

  function FlowErrs(p: Program): set<LintError> {
    var In := InEnvs(p);
    OverSections(p, FlowOf(p, In))
    + (if p.entry.section in In && !Approx(In[p.entry.section], EntryEnv(p)) then {Err("E-UNBOUND", p.entry.src)} else {})
  }

  function FlowOf(p: Program, In: map<SectionId, Env>): SectionId -> set<LintError> {
    id => if IsInstr(p, id) && id in In then SeqErrs(p, In, Body(p, id), In[id], {}, None) else {}
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
    requires StmtErrs(p, In, s, e, lv, gov) == {}
    ensures StmtOk(p, In, s, e, lv, gov)
    decreases s, 1
  {
    var errs := StmtErrs(p, In, s, e, lv, gov);
    forall x | x in CmdVars(s) ensures CmdVarOk(p, e, x) {
      if err :| err in CmdVarErrs(p, e, x, s.src) { assert err in errs; }
      var ks := KindsOf(e, x);
      if x !in e.bound { assert Err("E-UNBOUND", s.src) in CmdVarErrs(p, e, x, s.src); }
      if KRun in ks { assert Err("E-TAINT", s.src) in CmdVarErrs(p, e, x, s.src); }
      if KAction in ks { assert Err("E-ACTION-IN-CMD", s.src) in CmdVarErrs(p, e, x, s.src); }
      if KParam in ks && !(x in p.params && SafeParam(p.params[x])) {
        assert Err("E-UNSAFE-VALUE", if x in p.params then p.params[x].src else s.src) in CmdVarErrs(p, e, x, s.src);
      }
      forall k | k in ks && k.KValue? ensures ValuesSafe(p, k.list) {
        if IsData(p, k.list) {
          forall i | i in DataList(p, k.list).items && i.Value? ensures SafeValue(i.value) {
            if !SafeValue(i.value) { assert Err("E-UNSAFE-VALUE", i.src) in CmdVarErrs(p, e, x, s.src); }
          }
        }
      }
    }
    forall x | x in OperandVars(s) ensures x in e.bound {
      if x !in e.bound { assert Err("E-UNBOUND", s.src) in errs; }
    }
    forall x | x in DoItems(s) ensures x in e.bound && KindsOf(e, x) == {KAction} {
      if x !in e.bound { assert Err("E-UNBOUND", s.src) in errs; }
      else if KindsOf(e, x) != {KAction} { assert Err("E-LIST-KIND", s.src) in errs; }
    }
    forall j | j in Jumps(s) ensures Approx(In[j.ref.id], Forget(e, lv + BindingSet(s))) {
      if !Approx(In[j.ref.id], Forget(e, lv + BindingSet(s))) { assert Err("E-UNBOUND", j.src) in errs; }
    }
    if s.ForEach? {
      SeqSound(p, In, s.body, LoopEntry(p, s, e), lv + {s.loopVar}, None);
    }
  }

  lemma SeqSound(p: Program, In: map<SectionId, Env>, body: seq<Stmt>, e: Env, lv: set<Name>, gov: Option<Name>)
    requires JumpsIn(In, body)
    requires SeqErrs(p, In, body, e, lv, gov) == {}
    ensures SeqOk(p, In, body, e, lv, gov)
    decreases body, 0
  {
    if |body| > 0 {
      FlatParts(body);
      StmtSound(p, In, body[0], e, lv, gov);
      SeqSound(p, In, body[1..], After(p, body[0], e), lv, NextGov(body[0], gov));
    }
  }

  lemma FlowSound(p: Program)
    requires EntryOk(p) && RefsOk(p)
    requires CycleErrs(p) == {} && FlowErrs(p) == {}
    ensures FlowOk(p)
  {
    var In := InEnvs(p);
    forall id | IsInstr(p, id) ensures id in In && SeqOk(p, In, Body(p, id), In[id], {}, None) {
      assert id in Ids(p);
      forall s, j | s in Flat(Body(p, id)) && j in Jumps(s) ensures j.ref.id in In {
        assert s in Stmts(p);
        assert IsInstr(p, j.ref.id);
      }
      if err :| err in SeqErrs(p, In, Body(p, id), In[id], {}, None) { InOverSections(p, FlowOf(p, In), id, err); }
      SeqSound(p, In, Body(p, id), In[id], {}, None);
    }
    assert p.entry.section in Ids(p);
    assert FlowOkWith(p, In);
  }

  // ---- warnings ----

  function Warnings(p: Program): seq<LintError> {
    Sorted(UnreachedWarns(p) + NoGuidanceWarns(p) + ScoreWarns(p)
           + (if CycleErrs(p) == {} then NoContextWarns(p) else {}))
  }

  // No chain of transfers from the entry reaches the section.
  function UnreachedWarns(p: Program): set<LintError> {
    if !IsInstr(p, p.entry.section) then {}
    else
      var reached := Closure(p, {p.entry.section});
      set id | id in Ids(p) && id !in reached :: Err("W-SECTION-UNREACHED", p.sections[id].src)
  }

  // A section offered as an option has no guidance to describe it.
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

  function NoContextWarns(p: Program): set<LintError> {
    var In := InEnvs(p);
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
  function ScoreWarns(p: Program): set<LintError> {
    OverSections(p, id => if IsInstr(p, id) then ScoreWarnsIn(p, id, Flat(Body(p, id)), 0) else {})
  }

  function ScoreWarnsIn(p: Program, id: SectionId, flat: seq<Stmt>, i: nat): set<LintError>
    requires IsInstr(p, id)
    decreases |flat| - i
  {
    if i >= |flat| then {} else ScoreWarn(p, id, flat, i) + ScoreWarnsIn(p, id, flat, i + 1)
  }

  function ScoreWarn(p: Program, id: SectionId, flat: seq<Stmt>, i: nat): set<LintError>
    requires IsInstr(p, id) && i < |flat|
  {
    var s := flat[i];
    if !(s.Ask? && s.form.Score?) then {}
    else
      var x := s.form.binding;
      var later := (set j | i < j < |flat| :: flat[j])
                   + (var reach := Closure(p, {id}); set t, u | t in reach && t != id && IsInstr(p, t) && u in Flat(Body(p, t)) :: u);
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
