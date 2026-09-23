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
| `core/Step.dfy`, `src/step.ts` | The step interface: `Next`, `Response`, `Outcome`, `RunConfig`, and `CoreEvent`, with `EVENT_FIELDS` saying which event fields the core fills and which the host adds (SPEC §5.2). `tests/step.test.ts` keeps the names in step and checks the split covers the event contract. | core (C) and host (G) |
| `error-codes.json` | Error and warning codes, generated from SPEC §7.1 by `scripts/check_spec.py codes` | everyone who reports errors |
| `ask.schema.json` | Backend request, answer and failure (SPEC §6.1). The answer schema checks shape only; the core rejects bad numbers (P5). | host (G) and backends (D) |
| `fakes.schema.json` | `answers.yaml` and `commands.yaml` for the fake handlers (SPEC §5.4, §6.2) | fakes (D, E) and tests (F) |
| `event.schema.json` | One line of skop's JSON Lines output (SPEC §10): one shape per event | everyone who emits events |
| `examples/events.jsonl` | One example of every event kind; a test checks they cover the schema | G, F |
| `examples/spike-program.json` | The Phase 0 spike's section: `run`, `do`, `stop` with literal commands | spike only |

The spike's `core/Syntax.dfy`, `Lint.dfy` and `Interp.dfy` stay until
stream C replaces them with code on `Ast.dfy` and `Step.dfy`.

**Host ↔ `skop-ask` environment variables.** The host launches `skop-ask`
per run with these instead of re-reading `config.yaml` (PLAN.md §4 E owns
parsing that file); `skop-ask` validates the numeric ones itself and fails
fast as `E-CONFIG` before calling out to a backend:

| Variable | Meaning | Validation |
|---|---|---|
| `SKOP_ASK_BACKEND` | `ask.backend`: `jev`, `openrouter` or `fake`. Default `jev`. | `fake` is rejected — the host handles `--fake` itself (SPEC §5.4) and must never invoke `skop-ask` for it. Anything else unknown is `E-CONFIG`. |
| `SKOP_ASK_RETRIES` | `ask.retries` (SPEC §6.2). Default `1`. | integer, 0–3, else `E-CONFIG`. |
| `JEV_KEY_ENV` | Name of the env var holding the Jev API key. Default `TYPESAFE_API_KEY`. | — |
| `TYPESAFE_API_KEY` (or whatever `JEV_KEY_ENV` names) | Jev's bearer key. | required when `ask.backend: jev`, else `E-CONFIG`. |
| `JEV_MODEL` | `jev.model`, a versioned id (SPEC §6.2). | required when `ask.backend: jev`, else `E-CONFIG`. |
| `OPENROUTER_KEY_ENV` | Name of the env var holding the OpenRouter API key. Default `OPENROUTER_API_KEY`. | — |
| `OPENROUTER_API_KEY` (or whatever `OPENROUTER_KEY_ENV` names) | OpenRouter's bearer key. | required when `ask.backend: openrouter`, else `E-CONFIG`. |
| `OPENROUTER_MODEL` | `openrouter.model`. | required when `ask.backend: openrouter`, else `E-CONFIG`. |
| `OPENROUTER_MIN_MASS` | `openrouter.min_mass` (SPEC §9). Default `0.5`. | number, `0 < x <= 1`, else `E-CONFIG`. |

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
  reports `E-UNRESOLVED` when they differ (SPEC §3.4). `expected` is the
  GitHub slug of the heading the link text resolves to, so
  `[Clean_Up](#clean-up)` matches `## Clean up`. When the text resolves to
  no section, `expected` is the slug of the text itself, and the core
  reports the missing section anyway.
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
