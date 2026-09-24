// The core program (SPEC §5.1) as Dafny datatypes: a one-to-one mirror of
// contracts/core-program.schema.json. The adapter (src/core.ts) builds these
// from the preprocessor's JSON and rejects anything the schema rejects.
//
// Phase 0 contract: lint and the interpreter are built on these types.
module SkopeAst {
  type Src = nat          // 1-based line in SKILL.md
  type SectionId = string // "s:" + slug (SPEC §3.4)
  type Name = string

  datatype Option<T> = None | Some(value: T)

  // Text split into literal and variable parts, so the core never scans for `{`.
  datatype Part = Lit(s: string) | Var(name: Name)
  type Parts = seq<Part>

  // `anchor` only for a real link `[text](#anchor)`; E-UNRESOLVED if given != expected.
  datatype Anchor = Anchor(given: string, expected: string)
  datatype SectionRef = SectionRef(id: SectionId, anchor: Option<Anchor>)

  datatype Else = NoElse | Skip | ElseTo(ref: SectionRef)
  datatype Target = StopTarget | To(ref: SectionRef)

  // A command, or `do step`: the name of a for-each variable over action items.
  datatype DoBody = DoCmd(cmd: Parts) | DoItem(item: Name)

  datatype CmpOp = Lt | Le | Gt | Ge | Eq | Ne
  // `num` is the decimal as written, with any trailing % dropped (SPEC §3.4).
  datatype Operand = VarOp(name: Name) | Num(text: string)
  datatype Cond = Succeeds(cmd: Parts) | Cmp(op: CmpOp, l: Operand, r: Operand)

  datatype AskOption = AskOption(src: Src, ref: SectionRef)
  datatype RubricLine = RubricLine(src: Src, level: int, text: string)
  // Exactly one form per ask (SPEC §4.7). YesNo binds `_yn` when the skill doesn't name it.
  datatype AskForm =
    | Sections(options: seq<AskOption>)
    | YesNo(binding: Name)
    | OneOf(list: SectionRef, binding: Name)
    | Score(low: int, high: int, rubric: seq<RubricLine>, binding: Name) // v1.1

  datatype Stmt =
    | Run(src: Src, cmd: Parts, binding: Option<Name>, els: Else)
    | Do(src: Src, action: DoBody, els: Else)
    // onTrue is None for the `check COND else …` form, which then needs an else.
    | Check(src: Src, cond: Cond, onTrue: Option<Target>, els: Else)
    | Ask(src: Src, question: Parts, sure: nat, form: AskForm, els: Else)
    | ForEach(src: Src, loopVar: Name, list: SectionRef, body: seq<Stmt>)
    | IfYesRun(src: Src, cmd: Parts, els: Else) // INLINE has no `as` (SPEC §3.4)
    | IfYesDo(src: Src, action: DoBody, els: Else)
    | Then(src: Src, ref: SectionRef)
    | Page(src: Src, text: Parts)
    | HandOff(src: Src)
    | Stop(src: Src)

  // `text` is the action label (label is a Dafny keyword).
  datatype Item = Action(src: Src, text: string, cmd: Parts) | Value(src: Src, value: string)
  // `src` is the list's first item's line.
  datatype List = List(src: Src, items: seq<Item>)

  // Every `##` section. An instruction section has a body; any other has its lists.
  datatype Section =
    | Instructions(name: string, src: Src, guidance: Option<string>, body: seq<Stmt>)
    | Other(name: string, src: Src, lists: seq<List>)

  datatype Param = PStr(s: string, src: Src) | PInt(i: int, src: Src)

  datatype Limits = Limits(runTimeoutMs: nat, doTimeoutMs: nat, deadlineMs: nat, askContextTokens: nat)

  datatype Entry = Entry(section: SectionId, src: Src)

  datatype Program = Program(
    skill: string,
    entry: Entry,
    params: map<Name, Param>,
    limits: Limits,
    sections: map<SectionId, Section>)
}
