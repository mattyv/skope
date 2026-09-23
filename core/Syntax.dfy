// Core program types (SPEC §5.1). Phase 0 spike: only run, do and stop.
// This is a shared contract between lint and the interpreter (PLAN.md §3);
// it isn't frozen until the spike works end to end.
module SkopSyntax {
  datatype Kind = RunKind | DoKind

  datatype Stmt =
    | Run(src: nat, cmd: string)
    | Do(src: nat, cmd: string)
    | Stop(src: nat)

  datatype Program = Program(body: seq<Stmt>)
}
