# Design: skope as the plan in plan mode

Status: v1 in progress. Built: items 1–6 and 8 (changes, confinement with literal paths, effects and pinned files, the static diff, `--from`, `kind: plan`, progress). Plans' commands also run at the repository root. Not built yet: 7 and 9 (approval hooks, the skill).

## Problem

In Claude Code's plan mode, the agent explores, writes a plan, and a person
approves it before anything changes. Today that plan is prose: approving it
approves an intention, and the agent then does the work however it likes.

A skope plan makes the approved thing the thing that runs. It reads as a
checklist, `--effects` lists every command and every file change it can
make, and it ends in a known way: done, or handed back to the agent with a
record of what failed.

What we measured (Score-removal benchmark, seven rounds, one task): running
a finished plan is fast (edits under a second; the rest is the repo's
checks), but a planner that gets no feedback until the end loses to an agent
that edits as it goes (22.5 vs 13.5 min). So a plan must not be one shot:
checks are steps, a failed check hands back to the agent, and the next
attempt resumes instead of starting over. The value is not speed: it's that
what the person approved is exactly what runs.

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

## v1

1. **`edit`, `create`, `delete`.** New effect instructions.
   - `edit PATH` takes exactly one ```` ```old ```` block, then one ```` ```new ```` block.
     `old` is non-empty and matches whole lines, after CommonMark strips the
     list item's indent. An empty `new` deletes the lines; a missing `new` is
     `E-GRAMMAR`. `old` must occur exactly once; `· all` replaces every
     occurrence (at least one). Otherwise: failure handling (§4.3), file
     untouched.
   - **Idempotent:** if `old` is absent and `new` occurs exactly once, the
     edit is already applied: an `edit_already_applied` event, and the run
     goes on. This makes resuming safe (item 5), and a retry never needs the
     agent to rewrite `old`, so the plan's hash doesn't change.
   - `create PATH` takes one ```` ```new ```` block, makes parent directories, and
     fails if the file exists (unless its content is already `new`: already
     applied). `delete PATH` removes a file, never a directory, and is
     already applied if the file is gone.
   - Files: refuse NUL bytes or invalid UTF-8 (`E-BINARY`); match with line
     endings normalised and write back the file's own ending (mixed endings
     fail); write to a temp file and rename, keeping the file's mode.
   - They are effects, like `do`: `effect_start`/`effect_end` events, never
     applied in a dry run, counted in `effects`.
2. **Confinement.** PATH resolves (`realpath`) inside the repository root
   (the git work tree, else the plan's directory) and never under `.git/`;
   a symlink whose target leaves the root is refused. PATH may use params
   only if they have fixed choices, and never run output: an open param or
   a run output in PATH is `E-TAINT`. The safe-value check allows `/` and
   `.`, so `--param dir=../../.ssh` would otherwise pass.
3. **Effects and staleness.** `--effects` lists each change as
   `(kind, path, old, new, all)`, and the effects hash covers all of it, so
   approving the hash approves the exact text. `--effects` also records the
   sha256 of each touched file as it is now; a run refuses to start
   (`E-PLAN-STALE`) if any differs. That makes "don't touch files the plan
   edits" enforced, not just a rule.
4. **The diff is static.** `--effects --diff` prints one unified diff of every
   edit, create and delete in document order per file, applied to an
   in-memory copy, whatever path a run would take. A dry-run walk can't do
   this: its checks run against the unedited files, so it often branches to
   `[Fix]` and never reaches later edits. The dry run still emits
   `would_edit` for the edits on its path.
5. **Resume: `--from [Section]`.** The host sets the program's entry to that
   section before lint, so a name bound only in skipped sections is
   `E-UNBOUND`, as for any entry. With idempotent edits, re-running a
   section whose edits half-applied is safe. `run_start` and the handoff
   record carry `from`.
6. **`kind: plan`.** A skope-block field (§3.1 lists it as allowed). Plans get
   longer default limits (`run_timeout` and `do_timeout` 10m, `deadline` 60m)
   and keep 16 KB of each failed command's stdout and stderr in the handoff
   record's detail (skills keep a 2 KB tail in events). The run directory
   keeps each command's full redacted output as `exec-<n>.log`, named in the
   record.
7. **Approval: the person, not the agent.** The agent can't approve its own
   plan: it computes the hash, so passing a hash it computed proves nothing.
   Plans use skope's existing approval (§7.4): the approval file is written
   by `skope <plan> --approve`, which the agent never runs. In Claude Code
   the person's plan-mode approval triggers it: a hook on leaving plan mode,
   run by Claude Code as the user, runs `skope <plan> --approve` for the plan
   the agent presented. `--pin HASH` remains as a change detector only (the
   run refuses if the plan's effects changed), not as approval.
8. **Progress.** One stderr line per instruction (`[3/12] check npm test…`)
   when stderr is a terminal or `--progress` is given.
9. **The `plan-with-skope` skill**, installed with skope. In plan mode: write
   the plan as a `kind: plan` file under `.claude/plans/`; `--lint` and
   `--verify` it; show the person the plan, `--effects` and `--effects --diff`;
   after approval (the hook writes the approval) run it with `--apply`; on a
   handoff read the record, fix the plan and resume with `--from`. Rules: a
   check after each risky group of edits, a `Fix` section that hands off for
   every check, never edit files the plan touches while it's in progress.

## How it fits the core

- As built: to the core a change is a `do` whose command is its
  descriptor (`edit PATH`), the same way a sweep is a `run` to the core. The
  core never sees the text, so it needs nothing new: dry-run safety (P3),
  the effect events and termination apply unchanged. The host applies the
  change by its line and never runs the descriptor. Paths are literal in v1,
  so taint has nothing to check; params with choices can come later.
- Considered: a structured `Next.Edit(...)` with its own events. It would
  add proof work for no new guarantee, since the core would still not see
  file contents.
- Host-tested: matching, idempotence, confinement, line endings, atomic
  write, the static diff and the stale check. The core is pure and never
  sees file contents.
- Preprocessor: fenced code in list items is kept today only as an opaque
  block (`src/preprocess/blocks.ts`). It must keep the fence's text and info
  string for items, require `old` then `new` under `edit` and one `new`
  under `create`, and make any other fence under an instruction
  `E-GRAMMAR`. SPEC §3.3 rule 8 ("code blocks are opaque") gets a matching
  exception.

## v2

- **Undo.** `run_start` records a snapshot of the whole tree, untracked files
  included (a temporary index: `git add -A`, `git write-tree`); `skope --undo
  RUN_ID` restores it. `git stash create` isn't enough: it skips untracked
  files, so a `create` wouldn't be undone.
- **`in parallel`.** A block of `run` and `check` statements the host runs
  concurrently; results are reported in order and the first failure in
  order goes to failure handling. To the core it's the same statements in
  sequence. Most of a plan's wall time is checks.
- **Jev in plans**, once plans repeat (a migration run on many repos).

## Not doing

- Generating plans. The agent writes them; skope checks and runs them.
- Letting run output reach an edit, its path, or a command.

## Approval hooks (research, for item 7)

- **Claude Code:** `PostToolUse` with matcher `ExitPlanMode` fires only after
  the person approves (PreToolUse and PermissionRequest fire before, so they
  must not be used). stdin has `tool_input.plan`, `tool_input.planFilePath`,
  `tool_response.plan` (the approved text, after any edits by the person),
  `cwd`, `session_id` and `transcript_path`. Goes in `~/.claude/settings.json`.
- **Codex CLI:** plan approval isn't a tool call. Choosing "Yes, implement this
  plan" submits the user message `Implement the plan.`, so the hook is
  `UserPromptSubmit` matching that text (or the clear-context prefix); the
  plan text comes from the transcript's last `<proposed_plan>`. Codex hooks
  need the person's trust in `/hooks`, pinned by hash.
- **Both:** the agent could run the approval command itself through its shell.
  The hook entry point must check it was called as a hook: the transcript
  must end in the approval (an `ExitPlanMode` tool result, or the user
  message), for this plan file.

## Open questions

- The plan-mode hook: which Claude Code hook fires on the person's approval,
  and how does it learn which plan file was presented? (Candidate: the plan
  text names the file; the hook reads it from the approved plan.)
- Resume granularity: is a section enough, given idempotent edits?
