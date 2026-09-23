# Contracts

Shared shapes that parallel streams build against (PLAN.md §3). A change
here is a contract change (PLAN.md §10): the owner makes it, updates the
examples, and every affected stream follows.

**Status: frozen** at the end of Phase 0. `src/contracts.gen.ts` holds the
TypeScript types, generated from the schemas by `scripts/gen-types.mjs`; a
test fails if it's stale.

| File | Contract | Between |
|---|---|---|
| `core-program.schema.json` | Core program JSON, v2 (SPEC §5.1) | preprocessor (A) and core (B, C) |
| `examples/*.core.json` | The three example skills as core JSON. Also the M1 goldens: the preprocessor must produce exactly these. | A, B, C, F |
| `core/Ast.dfy` | The same program as Dafny datatypes | adapter and core (C) |
| `core/Step.dfy`, `src/step.ts` | The step interface: `Next`, `Response`, `Outcome`, `RunConfig` (SPEC §5.2). `tests/step.test.ts` keeps the names in step. | core (C) and host (G) |
| `error-codes.json` | Error and warning codes, generated from SPEC §7.1 by `scripts/check_spec.py codes` | everyone who reports errors |
| `ask.schema.json` | Backend request, answer and failure (SPEC §6.1). The answer schema checks shape only; the core rejects bad numbers (P5). | host (G) and backends (D) |
| `fakes.schema.json` | `answers.yaml` and `commands.yaml` for the fake handlers (SPEC §5.4, §6.2) | fakes (D, E) and tests (F) |
| `event.schema.json` | One line of skop's JSON Lines output (SPEC §10): one shape per event | everyone who emits events |
| `examples/events.jsonl` | One example of every event kind; a test checks they cover the schema | G, F |
| `examples/spike-program.json` | The Phase 0 spike's section: `run`, `do`, `stop` with literal commands | spike only |

The spike's `core/Syntax.dfy`, `Lint.dfy` and `Interp.dfy` stay until
stream C replaces them with code on `Ast.dfy` and `Step.dfy`.

Decisions the spec left open, made here:
- **`src` is the 1-based line number in SKILL.md.** That's the source-map
  id SPEC §5.1 asks for, so no separate source-map file is needed. `entry`
  and each param carry one too; a defaulted `entry` points at the first
  instruction section's heading.
- **One namespace.** Every `##` section is in `sections`, keyed by `s:`
  plus its slug: lowercase, with every run of other characters turned into
  `_` ("Clean up" is `s:clean_up`). An instruction section has `body`; any
  other section has `lists`. Every reference, target or list, is
  `{"section": id}`, so the core tells apart `E-UNRESOLVED` (no such
  section), `E-REF-KIND` (a target that isn't an instruction section) and
  `E-SECTION-KIND` (a list reference to a section without exactly one list).
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
- **`sure` is 0–100.** Anything else fails the schema; the preprocessor
  reports it as `E-GRAMMAR`.
- **Fakes** are keyed by the text exactly as it would be sent (a question
  names run outputs in backticks), or by `line:N`, which wins. A list of
  command results is used in order and the last repeats. `unsure` is a
  uniform answer, so the gate always fails; `unavailable` is a backend
  failure. `ms` advances the host's clock, so deadline scenarios can be
  written.
- **Events:** `run_id`, `skill` and `skill_hash` are `null` before a run
  exists. `caller` is `person` or `agent`. `skop_build` is bare hex. A
  failed `ask` has `null` answer fields and a `detail`. A warning's `stage`
  is the stage that found it.
- **Dafny names** differ where Dafny reserves a word: `as` is `binding`,
  `then` is `onTrue`, `var` is `loopVar`, `label` is `text`, and a `do`'s
  body is `action`.
