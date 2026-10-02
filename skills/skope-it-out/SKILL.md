---
name: skope-it-out
description: In plan mode, write repeatable workflows or substantial, bounded code changes as reviewable Markdown plans that skope runs. Use when the person wants to review the full set of changes before applying them, or when exact approval, repeatable execution, or resuming after failure adds value and skope is installed. Skip trivial one-off edits unless full review or skope is requested.
---

# Planning with skope

A skope plan is a Markdown checklist that `skope` runs. The person reads the
exact file patches, every command the plan can run, and one diff
of every file it changes. When they approve the plan, a hook records the
approval, and skope then runs exactly that: nothing else, and not after
anyone changes the plan or the files. If a check fails, the plan hands back
to you with the output, and you fix and resume.

Choose skope when the task benefits from a reusable procedure or an exact,
reviewable sequence that can resume after a failed check. Good fits include
repeated maintenance, releases, migrations, and substantial changes with
several planned phases and meaningful checks. The edits and commands must
be clear enough to specify up front. Also use skope when the person wants
to see the complete diff and command list before anything is applied, even
for a small change: the approved plan pins exactly what will run.
Keep exploration and open-ended debugging in the normal agent workflow.

For small or trivial one-off changes without that review requirement, use
normal editing and appropriate checks. Examples include a typo, a short documentation update, a simple
rename, or a small local fix. Being in plan mode does not by itself justify
a skope plan. Large exploratory prototype refactors are also a poor fit
while the intended changes are still evolving. Keep that work in the normal
agent workflow until there is a bounded set of changes to review.
Judge whether review, reuse, or resuming adds enough value to
justify writing and approving an executable plan; do not use a fixed file
count or line count as the threshold.

Apply these criteria in Claude Code or Codex plan mode; the person need not
name the skill. Honor an explicit request to use skope or to review the full set of changes
before applying them, even for a small change. Once a skope plan is in progress, continue through skope rather than
switching to manual edits because the remaining work looks small.

In Codex, the person must trust the installed
plan-approval hook with `/hooks` before approving the first plan.
In Claude Code, if skope was installed during this session, have the person
check `/hooks` before the first approval. It must show skope's `PostToolUse`
hook for `ExitPlanMode`. Settings edits normally load automatically; if the
hook is missing after a few seconds, restart Claude Code and resume the
conversation before presenting the plan. `/hooks` displays hooks; it does
not reload them.

## 1. Explore, then write the plan

Write the executable plan at `.skope/plans/NAME.md` in the repository for
both Claude Code and Codex. Use that path as `PATH` below and run skope from
the repository root. Approval pins that repository and the touched files.

In Claude Code, keep its native plan file under `$CLAUDE_CONFIG_DIR/plans/`
(normally `~/.claude/plans/`) as a short approval brief that points to `PATH`.
Do not put the executable plan's full body in that file. Existing executable
plans in Claude's plans directory remain supported.

When a prototype exists in a separate complete scratch tree or worktree,
generate the plan instead of copying old/new blocks by hand:

```console
$ skope plan --from-tree /path/to/prototype --output .skope/plans/NAME.md --check 'npm run typecheck' --check 'npm test'
```

Choose checks appropriate to the task; the command adds only the checks
you specify. The current repository is the base; `--base DIR` chooses a
different base. Generation never applies, approves, or resets base files.
The prototype must be a complete tree: a missing base file becomes a deletion.
Git-ignored output and `.skope/` files are excluded. Binary files, symlinks,
mode changes, and line-ending conversions are refused.

For an existing unified diff, use
`skope plan --from-diff changes.diff --output .skope/plans/NAME.md`. The diff
must apply to the base's current files. Its content is embedded in the plan,
so changing the source diff later cannot change the approved plan.

Prefer `patch` with an inline `diff` fence for manual edits; hunk positions
and context must match exactly. Use `edit`, `create`, and `delete` when
those forms make the change easier to read.

The compact example below illustrates the syntax. A small retry-limit
change would usually use normal editing unless skope or a full review before applying was requested.

````markdown
---
name: retry-limit
description: Raise the retry limit to 5 and test it.
---

# Retry limit

*A [skope](https://github.com/mattyv/skope) plan. Run it with `skope`, never by hand.*

```skope
format: 1
kind: plan
```

## Change
Raise the limit; the client and its test both read it.

- **edit** `src/client.ts`
  ```old
  const retries = 3;
  ```
  ```new
  const retries = 5;
  ```
- **edit** `test/client.test.ts`
  ```old
  expect(client.retries).toBe(3);
  ```
  ```new
  expect(client.retries).toBe(5);
  ```
- **check** `npx tsc --noEmit` succeeds · else [Fix]
- **then** [Test]

## Test
- **check** `npm test` succeeds · else [Fix]
- **stop**

## Fix
A check failed. The record has the command's output; fix the plan and resume.

- **hand off**
````

- **Patches:** a **patch** step followed by a `diff` fence contains a
  standard unified diff for exactly PATH (`a/PATH` and `b/PATH`, or
  `/dev/null` for creating or deleting). Skope applies it without offsets
  or fuzz. Patch text is covered by the approval hash.
- **Edits:** `old` is whole lines copied exactly from the file, including
  indentation; add a line of context if it isn't unique, or `· all` to
  change every match. An empty `new` deletes the lines. Use `create` with a
  path and `new` block to add a file, or `delete` with a path to remove one.
  Represent a move as a deletion and a creation. Create the Git branch
  before applying the plan; do not put Git commands in a code-change plan.
- **Checks after each group of edits**, cheapest first (types, then tests),
  each with `· else [Fix]`. The Fix section hands off; it's how you get
  feedback.
- **One section per phase** (Change, Test, …): after a fix you resume from a
  section.
- **Commands** are for building and testing, not for changing files: every
  change is a `patch`, `edit`, `create` or `delete`, so the person sees its text.
- **Judgement calls** use the rest of the skope language, documented in the
  write-skope-skill skill: `run … as var`, `do`, `ask … · sure N%`,
  `for each`, `page`, and `params` with fixed `choices` (one approval, several
  presets). Use them where a plan would otherwise hand off blindly: `run`
  the failing log, `ask` whether it is a flake or a real failure, and route
  to a retest or to Fix. `**if yes**` only takes `run CMD` or
  `do CMD`, so to route on an answer use the `[Section]` option-list form of
  `ask`. Run formatters in check mode and include formatting changes in
  explicit edits. Approval pins the file states produced by those edits;
  a formatter's fix command can leave a pinned file in an unapproved state,
  causing a later edit or resumed run to fail with `E-PLAN-STALE`.
- **Set `limits`** when a `check` can run long: a plan's `run_timeout`
  defaults to 10 minutes, and a fresh sanitizer build that hits it fails
  the plan.
- **Explain why, in prose.** The person reads the plan to decide whether to
  approve it, so each section opens with a paragraph saying what it does and
  why, and each edit or group of edits is preceded by a paragraph saying why
  it is there and what breaks without it. Prose between list items is
  allowed; the lists still run in document order. A Context section before
  the first instruction section states the problem, the constraint, what was
  considered and left alone, and what is out of scope.
- **Write the prose plainly.** Active voice. Positive statements. Concrete
  nouns and verbs, not "robust" or "seamless". Cut every word that does no
  work. One topic per paragraph, its point in the first sentence. Say what
  the code does, not what it "ensures" or "leverages". A guidance paragraph
  is also what the model sees when a section is an `ask` option, so clarity
  there changes which branch runs.

- Use descriptive section headings: `--stream` shows them while the plan
  runs. Keep prose short: a line under each heading saying what the section does.

## 2. Check it, then show it

```console
$ skope PATH --lint
$ skope PATH --verify
$ skope plan PATH --review --diff
```

Fix lint errors or any patch that cannot apply. Read `--verify` for unreachable
sections, how each path ends, and the worst-case run time against
`limits.deadline`. Correct those problems before approval.
`--dry-run` requires approval, so use `--review --diff` for the preview. Show the complete diff and
command list once for the person to review. Then generate the short text
for approval:

```console
$ skope plan PATH --review
```

Copy its full `skope plan: PATH HASH` line exactly, with all 64 hash digits,
and its short summary and command list into the plan-mode approval text.
In Claude Code, write that brief to the native plan file. In Codex, present
the brief as the final plan. Do not echo the executable Markdown plan or
repeat the complete diff in the approval text. The person must have reviewed
the full changes before approving; a compact brief does not replace review.

Generation and `--review` compute the approval marker, so no placeholder
hash or hash insertion into the executable plan is needed. Recompute the
brief after any edit. The hook approves only the referenced file with that
hash, and still verifies the person's approval in the host transcript.

In Claude Code, the hook runs after the person accepts `ExitPlanMode`.
In Codex, it runs on `UserPromptSubmit` when approval sends
`Implement the plan.` or the fresh-context implementation message carrying
the approved plan. If the person rejects the plan or leaves plan mode
without approving, return to plan mode and present the plan again.

The approval is the person's: skope refuses `--approve` on a plan, and an
approval file you write counts for nothing. Never run
`skope --plan-approved` yourself.

## 3. Run it

Use `--stream` for each run and resume. It prints a readable checklist and
live redacted output to stderr instead of JSON events. Keep the
command output visible in the host’s command panel.

Once the person approves (you're out of plan mode):

```console
$ SKOPE_CALLER=agent skope PATH --apply --stream
```

- **Exit 0:** done. Tell the person what changed.
- **Exit 20, a handoff:** read the record it names. Its `detail` has the
  failed command, its output and a `log` file with all of it. Fix the plan:
  change an edit, or add one. Then:
  - if `--effects` gives the same `effects_hash` (you changed no edit's
    text and no command), resume: `skope PATH --apply --stream --from SECTION`, where
    SECTION is where the failure was.
  - otherwise the plan needs approving again. First take out the edits the
    run already made (`--effects --diff` reports them as not matching), so
    the plan and its diff show what's left. Then go back to plan mode (in
    Claude Code, enter plan mode; in Codex, ask the person to) and present
    it again: which edits already applied, what you changed and why, the
    new `skope plan:` line and the diff. Once approved, run it with
    `--apply --stream` from the start.
  Changes already in place are skipped on a re-run, so re-running is safe.
- **`E-NOT-APPROVED`:** nothing ran. Check whether the plan or its hash
  changed, and whether the approval hook ran. Install a missing hook with
  `skope --install-hooks`. In Claude Code, check `/hooks` for skope's
  `PostToolUse` hook on `ExitPlanMode`; if absent after a few seconds,
  restart Claude Code and resume the conversation. In Codex, check that
  the person trusted its hook with `/hooks`. Present the plan and its
  current `skope plan:` line again for the person to approve, even if the
  file and hash are unchanged. Then retry `--apply --stream`.
- **`E-PLAN-STALE`:** someone changed a file the plan edits. Look at what
  changed, update the plan, and ask for approval again.

Never edit the files a plan changes while it's in progress, other than
through the plan.
