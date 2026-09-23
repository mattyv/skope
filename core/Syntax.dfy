// Core program types (SPEC §5.1). Phase 0 spike: run, do and stop, with
// literal command parts. This is the contract between lint and the
// interpreter (PLAN.md §3), frozen at the end of Phase 0.
module SkopSyntax {
  datatype Kind = RunKind | DoKind

  // Commands arrive split into parts, and are joined here in the core so
  // that the taint property (P4) can be proven over them. The spike has
  // literal parts only; variables come with stream C.
  datatype Part = Lit(s: string)

  datatype Stmt =
    | Run(src: nat, cmd: seq<Part>)
    | Do(src: nat, cmd: seq<Part>)
    | Stop(src: nat)

  // One instruction section. src is its heading's line.
  datatype Program = Program(src: nat, body: seq<Stmt>)

  function Render(parts: seq<Part>): string {
    if |parts| == 0 then "" else parts[0].s + Render(parts[1..])
  }
}
