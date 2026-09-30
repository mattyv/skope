---
name: skope-it-out
description: In plan mode, write the plan as a skope plan, a Markdown file skope runs, so what the person approves is exactly what runs. Use when planning a change to a codebase in plan mode and skope is installed (`command -v skope`).
---

# Planning with skope

A skope plan is a Markdown checklist that `skope` runs. The person reads the
edits' exact old and new text, every command the plan can run, and one diff
of every file it changes. When they approve the plan, a hook records the
approval, and skope then runs exactly that: nothing else, and not after
anyone changes the plan or the files. If a check fails, the plan hands back
to you with the output, and you fix and resume.

Use it for changes you can plan up front: a set of edits, then builds and
tests. Keep exploring the normal way; the plan replaces only the writing and
running.

Use this workflow when the person asks for a code change in Claude Code or
Codex plan mode; they need not name the skill. They can ask for it explicitly
with "Use skope-it-out to plan this." In Codex, the person must trust the installed
plan-approval hook with `/hooks` before approving the first plan.
In Claude Code, if skope was installed during this session, have the person
check `/hooks` before the first approval. It must show skope's `PostToolUse`
hook for `ExitPlanMode`. Settings edits normally load automatically; if the
hook is missing after a few seconds, restart Claude Code and resume the
conversation before presenting the plan. `/hooks` displays hooks; it does
not reload them.

## 1. Explore, then write the plan

Choose the plan file for your agent:

- **Claude Code:** use the plan file Claude Code gives you under
  `$CLAUDE_CONFIG_DIR/plans/` (normally `~/.claude/plans/`). Write the skope
  plan directly in that file. Use its absolute path as `PATH` below. There is
  no repository plan file to create or commit.
- **Codex:** write `.skope/plans/NAME.md` at the repository root and use that
  relative path as `PATH` below.

Run skope from the repository root. Changes and commands in either plan use
that repository; approval pins it as well as the files the plan changes.

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

- **Edits:** `old` is whole lines copied exactly from the file, including
  indentation; add a line of context if it isn't unique, or `· all` to
  change every match. An empty `new` deletes the lines. Use `create` with a
  path and `new` block to add a file, or `delete` with a path to remove one.
  There is no move or rename: a moved file is a `delete` and a `create`
  with the full new text, so the person sees it all. There is no git
  either: say in the Context that the branch is created by hand before
  `--apply`, and never put `git` in a command.
- **Checks after each group of edits**, cheapest first (types, then tests),
  each with `· else [Fix]`. The Fix section hands off; it's how you get
  feedback.
- **One section per phase** (Change, Test, …): after a fix you resume from a
  section.
- **Commands** are for building and testing, not for changing files: every
  change is an `edit`, `create` or `delete`, so the person sees its text.
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

## 2. Check it, then show it

```console
$ skope PATH --lint
$ skope PATH --verify
$ skope PATH --effects --diff
```

Fix anything `--lint` reports. Read `--verify`: it lists every section,
how each path ends, and the worst-case run time against `limits.deadline`;
an unreached section or a worst case past the deadline is a plan bug.
These three are the only checks that run before approval: `--dry-run` is
gated by the same approval as `--apply`, so do not offer it as a preview.
Then put this in the plan you present for approval, word for word from
`--effects` (all 64 hex digits after `sha256:` in `effects_hash`):

```
skope plan: PATH 3f1c…(64 hex digits)…9e0a
```

Replace `PATH` with the exact path used for `--effects`. In Claude Code the
approved plan is the plan file, so this line must be inside the file: put it
in the prose under the title, on its own line. It is prose, so the hash does
not cover it, and you can update it in place after each `--effects`. A line
that only appears in your chat message is never seen by the hook, and the
hook then records nothing. Follow the line, in your message, with a short
summary, the commands `--effects` lists, and the diff.
The hook approves only that file, only with that hash: if you change the
plan after the person saw it, it won't run. The hash covers edits and
commands, not prose, so rewording an explanation after review keeps the
approval; changing one character inside an `old`, `new` or command block
does not.

In Claude Code, the hook runs after the person accepts `ExitPlanMode`.
In Codex, it runs on `UserPromptSubmit` when plan approval sends
`Implement the plan.` or the fresh-context implementation message carrying
the approved plan. If the person rejects the plan or leaves plan mode
without approving it, re-enter plan mode and present the plan again,
however unchanged it is.

The approval is the person's: skope refuses `--approve` on a plan, and an
approval file you write counts for nothing. Never run
`skope --plan-approved` yourself.

## 3. Run it

Once the person approves (you're out of plan mode):

```console
$ SKOPE_CALLER=agent skope PATH --apply
```

- **Exit 0:** done. Tell the person what changed.
- **Exit 20, a handoff:** read the record it names. Its `detail` has the
  failed command, its output and a `log` file with all of it. Fix the plan:
  change an edit, or add one. Then:
  - if `--effects` gives the same `effects_hash` (you changed no edit's
    text and no command), resume: `skope PATH --apply --from SECTION`, where
    SECTION is where the failure was.
  - otherwise the plan needs approving again. First take out the edits the
    run already made (`--effects --diff` reports them as not matching), so
    the plan and its diff show what's left. Then go back to plan mode (in
    Claude Code, enter plan mode; in Codex, ask the person to) and present
    it again: which edits already applied, what you changed and why, the
    new `skope plan:` line and the diff. Once approved, run it with
    `--apply` from the start.
  Changes already in place are skipped on a re-run, so re-running is safe.
- **`E-NOT-APPROVED`:** nothing ran. Check whether the plan or its hash
  changed, and whether the approval hook ran. Install a missing hook with
  `skope --install-hooks`. In Claude Code, check `/hooks` for skope's
  `PostToolUse` hook on `ExitPlanMode`; if absent after a few seconds,
  restart Claude Code and resume the conversation. In Codex, check that
  the person trusted its hook with `/hooks`. Present the plan and its
  current `skope plan:` line again for the person to approve, even if the
  file and hash are unchanged. Then retry `--apply`.
- **`E-PLAN-STALE`:** someone changed a file the plan edits. Look at what
  changed, update the plan, and ask for approval again.

Never edit the files a plan changes while it's in progress, other than
through the plan.
