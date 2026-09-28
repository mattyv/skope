---
name: plan-with-skope
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
with "Plan this with skope." In Codex, the person must trust the installed
plan-approval hook with `/hooks` before approving the first plan.

## 1. Explore, then write the plan

Write it to `.skope/plans/NAME.md` at the repository root. Paths in it are
relative to that root, and its commands run there.

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
- **Checks after each group of edits**, cheapest first (types, then tests),
  each with `· else [Fix]`. The Fix section hands off; it's how you get
  feedback.
- **One section per phase** (Change, Test, …): after a fix you resume from a
  section.
- **Commands** are for building and testing, not for changing files: every
  change is an `edit`, `create` or `delete`, so the person sees its text.
- Keep prose short: a line under each heading saying what the section does.

## 2. Check it, then show it

```console
$ skope .skope/plans/NAME.md --lint
$ skope .skope/plans/NAME.md --effects --diff
```

Fix anything `--lint` reports. Then put this in the plan you present for
approval, word for word from `--effects` (all 64 hex digits after
`sha256:` in `effects_hash`):

```
skope plan: .skope/plans/NAME.md 3f1c…(64 hex digits)…9e0a
```

followed by a short summary, the commands `--effects` lists, and the diff.
The hook approves only that file, only with that hash: if you change the
plan after the person saw it, it won't run.

The approval is the person's: skope refuses `--approve` on a plan, and an
approval file you write counts for nothing. Never run
`skope --plan-approved` yourself.

## 3. Run it

Once the person approves (you're out of plan mode):

```console
$ SKOPE_CALLER=agent skope .skope/plans/NAME.md --apply
```

- **Exit 0:** done. Tell the person what changed.
- **Exit 20, a handoff:** read the record it names. Its `detail` has the
  failed command, its output and a `log` file with all of it. Fix the plan:
  change an edit, or add one. Then:
  - if `--effects` gives the same `effects_hash` (you changed no edit's
    text and no command), resume: `skope .skope/plans/NAME.md --apply --from
    SECTION`, where SECTION is where the failure was.
  - otherwise the plan needs approving again. First take out the edits the
    run already made (`--effects --diff` reports them as not matching), so
    the plan and its diff show what's left. Then go back to plan mode (in
    Claude Code, enter plan mode; in Codex, ask the person to) and present
    it again: which edits already applied, what you changed and why, the
    new `skope plan:` line and the diff. Once approved, run it with
    `--apply` from the start.
  Changes already in place are skipped on a re-run, so re-running is safe.
- **`E-NOT-APPROVED`:** the plan changed since it was approved, or the hook
  did not run. Install a missing hook with `skope --install-hooks`; in Codex,
  check that the person trusted it with `/hooks`.
- **`E-PLAN-STALE`:** someone changed a file the plan edits. Look at what
  changed, update the plan, and ask for approval again.

Never edit the files a plan changes while it's in progress, other than
through the plan.
