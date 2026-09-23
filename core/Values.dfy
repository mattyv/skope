// Values the core computes with (SPEC §3.5, §4.2, §6.1): rendering, the
// safe-value check, number coercion for `check`, and the ask gate. Pure
// functions; P5 is proven here about Gate.
module SkopValues {
  import opened SkopAst
  import opened SkopStep
  import opened SkopWellFormed

  // ---- rendering ----

  function Digit(d: nat): char requires d < 10 { ('0' as int + d) as char }
  function NatToString(n: nat): string decreases n {
    if n < 10 then [Digit(n)] else NatToString(n / 10) + [Digit(n % 10)]
  }
  function IntToString(i: int): string { if i < 0 then "-" + NatToString(-i) else NatToString(i) }
  function Show(v: Val): string { match v case Str(s) => s case Int(i) => IntToString(i) }

  predicate IsDigit(c: char) { '0' <= c <= '9' }
  predicate AllDigits(s: string) { |s| > 0 && forall c <- s :: IsDigit(c) }

  // Digits pass the safe-value check (SafeValue, SPEC §3.5).
  lemma NatDigits(n: nat) ensures AllDigits(NatToString(n)) && SafeValue(NatToString(n)) {}

  // ---- coercion (SPEC §4.2: trim, strip one trailing %, parse as decimal) ----

  predicate Space(c: char) { c == ' ' || c == '\t' || c == '\n' || c == '\r' }
  function TrimStart(s: string): string { if |s| > 0 && Space(s[0]) then TrimStart(s[1..]) else s }
  function TrimEnd(s: string): string { if |s| > 0 && Space(s[|s| - 1]) then TrimEnd(s[..|s| - 1]) else s }
  function Trim(s: string): string { TrimEnd(TrimStart(s)) }
  function StripPct(s: string): string { if |s| > 0 && s[|s| - 1] == '%' then s[..|s| - 1] else s }

  function DigitsVal(s: string): nat requires forall c <- s :: IsDigit(c) {
    if |s| == 0 then 0
    else assert IsDigit(s[|s| - 1]); DigitsVal(s[..|s| - 1]) * 10 + (s[|s| - 1] as int - '0' as int)
  }
  function Pow10(n: nat): (r: nat) ensures r > 0 { if n == 0 then 1 else 10 * Pow10(n - 1) }
  function IndexOf(s: string, c: char): (i: nat) ensures i <= |s| {
    if |s| == 0 || s[0] == c then 0 else 1 + IndexOf(s[1..], c)
  }

  // -?DIGITS(.DIGITS)?
  function ParseNum(s: string): Option<real> {
    var neg := |s| > 0 && s[0] == '-';
    var t := if neg then s[1..] else s;
    var i := IndexOf(t, '.');
    var a := t[..i];
    var b := if i < |t| then t[i + 1..] else "";
    if !AllDigits(a) || (i < |t| && !AllDigits(b)) then None
    else
      var v := DigitsVal(a) as real + DigitsVal(b) as real / Pow10(|b|) as real;
      Some(if neg then -v else v)
  }

  // The text a value is compared as, when it's a number.
  function NumText(v: Val): Option<string> {
    match v
    case Int(i) => Some(IntToString(i))
    case Str(s) => var t := StripPct(Trim(s)); if ParseNum(t).Some? then Some(t) else None
  }
  function Coerce(v: Val): Option<real> {
    match v case Int(i) => Some(i as real) case Str(s) => ParseNum(StripPct(Trim(s)))
  }

  function Compare(op: CmpOp, a: real, b: real): bool {
    match op
    case Lt => a < b
    case Le => a <= b
    case Gt => a > b
    case Ge => a >= b
    case Eq => a == b
    case Ne => a != b
  }

  // ---- the ask gate (SPEC §4.2, §6.1) ----

  datatype Verdict = Invalid | Unsure(chosen: nat, conf: real) | Sure(chosen: nat, conf: real)

  function Ids(opts: seq<AskOpt>): seq<string> { seq(|opts|, i requires 0 <= i < |opts| => opts[i].id) }

  // The sum of probs over the distinct ids.
  function SumFirst(ids: seq<string>, probs: map<string, real>, i: nat): real
    requires forall id <- ids :: id in probs
    decreases |ids| - i
  {
    if i >= |ids| then 0.0 else (if ids[i] in ids[..i] then 0.0 else probs[ids[i]]) + SumFirst(ids, probs, i + 1)
  }

  predicate InUnit(x: real) { 0.0 <= x <= 1.0 }

  // Exactly the offered ids, every value (unassigned too) in [0, 1], summing to 1 within 1e-3.
  predicate ValidAnswer(ids: seq<string>, probs: map<string, real>, u: real) {
    |ids| > 0 && probs.Keys == (set id <- ids) && InUnit(u) && (forall id <- ids :: InUnit(probs[id]))
    && -0.001 <= SumFirst(ids, probs, 0) + u - 1.0 <= 0.001
  }

  function Total(ids: seq<string>, probs: map<string, real>, u: real): (t: real)
    requires ValidAnswer(ids, probs, u)
    ensures t > 0.0
  {
    SumFirst(ids, probs, 0) + u
  }

  function ArgMaxFrom(ids: seq<string>, probs: map<string, real>, i: nat, best: nat): (c: nat)
    requires forall id <- ids :: id in probs
    requires best < |ids| && best < i <= |ids|
    requires forall j | 0 <= j < i :: probs[ids[j]] <= probs[ids[best]]
    ensures c < |ids| && forall j | 0 <= j < |ids| :: probs[ids[j]] <= probs[ids[c]]
    decreases |ids| - i
  {
    if i == |ids| then best
    else ArgMaxFrom(ids, probs, i + 1, if probs[ids[i]] > probs[ids[best]] then i else best)
  }

  // Chosen = the highest probability; confidence = that probability after
  // normalising, never counting `unassigned`. The gate fails below `sure`,
  // or when another option given all of `unassigned` would match or beat it.
  function Gate(ids: seq<string>, probs: map<string, real>, u: real, sure: nat): Verdict {
    if !ValidAnswer(ids, probs, u) then Invalid
    else
      var t := Total(ids, probs, u);
      var c := ArgMaxFrom(ids, probs, 1, 0);
      var conf := probs[ids[c]] / t;
      if conf >= sure as real / 100.0 && forall j | 0 <= j < |ids| && j != c :: probs[ids[j]] / t + u / t < conf
      then Sure(c, conf)
      else Unsure(c, conf)
  }

  // P5, the gate's half: a gate passes only on a valid answer, picks one of
  // the offered options, and its confidence is that option's normalised
  // probability alone, at least `sure`, with no rival that `unassigned`
  // could lift to a tie.
  lemma GateSound(ids: seq<string>, probs: map<string, real>, u: real, sure: nat)
    ensures Gate(ids, probs, u, sure).Invalid? <==> !ValidAnswer(ids, probs, u)
    ensures !Gate(ids, probs, u, sure).Invalid? ==> Gate(ids, probs, u, sure).chosen < |ids|
    ensures var v := Gate(ids, probs, u, sure);
      v.Sure? ==>
        var t := Total(ids, probs, u);
        v.conf == probs[ids[v.chosen]] / t
        && v.conf >= sure as real / 100.0
        && forall j | 0 <= j < |ids| && j != v.chosen :: probs[ids[j]] / t + u / t < v.conf
  {}
}
