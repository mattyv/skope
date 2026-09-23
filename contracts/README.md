# Contracts

Shared shapes that parallel streams build against (PLAN.md §3). A change
here is a contract change (PLAN.md §10): the owner makes it, updates the
examples, and every affected stream follows.

**Status: draft.** They're frozen at the end of Phase 0, after the review
of the spike and contracts.

| File | Contract | Between |
|---|---|---|
| `core-program.schema.json` | Core program JSON (SPEC §5.1) | preprocessor (A) and core (B, C) |
| `examples/*.core.json` | The three example skills as core JSON. Also the M1 goldens: the preprocessor must produce exactly these. | A, B, C, F |
| `error-codes.json` | Error and warning codes, generated from SPEC §7.1 by `scripts/check_spec.py codes` | everyone who reports errors |
| `ask.schema.json` | Backend request and answer (SPEC §6.1). The answer schema checks shape only; the core rejects bad numbers (P5). | host (G) and backends (D) |
| `fakes.schema.json` | `answers.yaml` and `commands.yaml` for the fake handlers (SPEC §5.4, §6.2) | fakes (D, E) and tests (F) |
| `event.schema.json` | One line of skop's JSON Lines output (SPEC §10) | everyone who emits events |
| `src/core.ts` types (`CoreEvent`, `Next`, `Run.step`) | The step interface between the core and the host (SPEC §5.2) | core (C) and host (G) |
| `examples/spike-program.json` | The Phase 0 spike's section: `run`, `do`, `stop` with literal commands, in the contract's section shape | spike only |

Decisions the spec left open, made here:
- **`src` is the 1-based line number in SKILL.md.** That's the source-map
  id SPEC §5.1 asks for, so no separate source-map file is needed.
- **Ids** are `s:` or `l:` plus the slugified name: lowercase, with every
  run of other characters turned into `_` ("Clean up" is `s:clean_up`). A
  reference's prefix comes from where it's written: a target is always
  `s:`, a list reference always `l:`. The core reports `E-UNRESOLVED` or
  `E-REF-KIND` when the id doesn't match.
- **Links** `[text](#anchor)` carry `anchor: {given, expected}`, and the core
  reports `E-UNRESOLVED` when they differ (SPEC §3.4).
- **Guidance** is the paragraph's plain text: inline formatting removed,
  and a link or `[Section]` reference becomes its text (as in SPEC §6.2's
  example). `null` when the section has none.
- **Units:** durations in milliseconds; `4k tokens` is 4000.
- **Defaults are filled in** by the preprocessor: `limits` always has all
  four fields, and an unnamed yes/no binds `_yn`.
- **Operands** keep numbers as decimal strings, with the decorative `%`
  dropped (SPEC §3.4).
