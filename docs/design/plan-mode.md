# Design: skope as the plan in plan mode

Status: draft, for review.

## Problem

In Claude Code's plan mode, the agent explores, writes a plan, and a person
approves it before anything changes. Today that plan is prose: approving it
approves an intention, and the agent then does the work however it likes.

A skope plan would make the approved thing the thing that runs. It reads as
a checklist, `--effects` lists every command it can run, `--dry-run` shows
every change it would make, and it ends in a known way: done, or handed back
to the agent with a record of what failed.

What we measured (Score-removal benchmark, rounds 1–7, scratchpad
`benchmark-preregistration.md`): running a finished plan is fast (edits
under a second; the rest is the repo's checks), but a planner that gets no
feedback until the end loses to an agent that edits as it goes. So a plan
must not be one shot: checks are steps in the plan, a failed check hands
back to the agent, and the next attempt resumes instead of starting over.
Plan mode pays the planning cost anyway (a person waits for approval), so
this design targets execution, review and the feedback loop, not planning
speed.

## What a plan looks like

````markdown
---
name: remove-score
description: Remove the Score ask form.
---

# Remove Score

```skope
format: 1
kind: plan
```

## Grammar
Drop the range form; point writers at the two forms that remain.

- **edit** `src/preprocess/grammar.ts`
  ```old
    "→ LOW to HIGH as x",
  ```
  ```new
  ```
- **check** `npx tsc --noEmit` succeeds · else [Fix]
- **then** [Tests]

## Tests
- **run** `npm test`
- **stop**

## Fix
Type errors after the grammar change. Read the record, fix the plan, resume from [Grammar].

- **hand off**
````

## v1 (must have)

1. **`edit`, `create`, `delete`.** New effect instructions.
   - `edit PATH` takes a nested ```` ```old ```` block and a ```` ```new ```` block. The old
     text must occur exactly once (`· all` replaces every occurrence, at
     least one). No match, or more than one without `· all`: failure
     handling (§4.3), and the file is untouched.
   - `create PATH` takes one ```` ```new ```` block and fails if the file exists;
     `delete PATH` fails if it doesn't.
   - They are effects, like `do`: `effect_start`/`effect_end` events, never
     run in a dry run, counted in `effects`, listed by `--effects` with a hash
     of their text so the approval covers the exact change.
   - Taint: PATH and the blocks are author text; PATH may use params and list
     items, never run output (P4, extended). The core proves this and dry-run
     safety; the host applies the change (tested: exactly-once match, atomic
     write, line endings kept).
2. **Diffs in the dry run.** A dry run applies each edit to an in-memory
   copy, so later edits to the same file see earlier ones, and emits a
   `would_edit` event with a unified diff. It also writes `plan.diff` in the
   run directory: approving the plan means approving that diff plus the
   command list.
3. **`kind: plan`.** A skope-block field. Plans get longer defaults
   (`run_timeout` and `do_timeout` 10m, `deadline` 60m), a larger handoff
   tail (item 4), and no lockfile approval. Instead, the run takes
   `--expect-effects HASH`: the hash the person saw when they approved the
   plan. A changed plan refuses to run (`E-PLAN-CHANGED`). A plan without
   `--expect-effects` needs `--approve` like any skill.
4. **Failure detail for the agent.** For plans, the handoff record keeps
   16 KB of each failed command's stdout and stderr (redacted), not 2 KB,
   and the run directory keeps each command's full redacted output as
   `exec-<n>.log`, named in the record.
5. **Resume by section.** `--from [Section]` starts a run at a section
   instead of the entry, so the agent fixes the plan and re-runs from where
   it failed without redoing earlier edits or checks. Lint checks the plan
   from that section as an entry: a name bound only in skipped sections is
   `E-UNBOUND`.
6. **Progress.** One stderr line per instruction (`[3/12] check npm test…`)
   when stderr is a terminal or `--progress` is given.
7. **The `plan-with-skope` skill**, installed with skope. In plan mode:
   write the plan as a `kind: plan` file under `.claude/plans/`; lint and
   `--verify` it; show the person the plan, `--effects` and the dry-run diff;
   after approval run it with `--expect-effects`; on a handoff read the
   record, fix the plan, resume with `--from`. Rules: checks after each
   risky edit, a `Fix` section that hands off for every check, never edit
   files outside the plan while it's being run.

## v2 (should have)

- **Undo.** `run_start` records a `git stash create` snapshot; `skope --undo
  RUN_ID` restores it. Only when the tree is a git work tree.
- **`in parallel`.** A block of `run` and `check` statements the host runs
  concurrently (they don't change anything); results are reported in order,
  and the first failure in order goes to failure handling. To the core it's
  the same statements in sequence. Most of a plan's wall time is checks.
- **Jev in plans.** Already possible with `ask`; worth a pattern once plans
  repeat (migrations run on many repos).

## Not doing

- Generating plans. The agent writes them; skope checks and runs them.
- Letting run output reach an edit. An edit's text is the author's, always.

## Open questions

- Is `--expect-effects` enough as plan-mode approval, given the person
  approves in Claude Code, not in skope? Alternative: the skill runs
  `--approve` only after the person approves, which the run-skope-skill rule
  forbids today.
- Nested fenced blocks under list items: CommonMark supports them, but the
  preprocessor's "nested list under an instruction is a parse error" rule
  needs a matching exception for code blocks under `edit`/`create`.
- `--from`: resume by section is coarse. Is a section per phase (edit, then
  check) enough, or does resuming need step granularity?
