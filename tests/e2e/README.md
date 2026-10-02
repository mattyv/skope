# Plan-mode end-to-end tests

Two layers check that `skope-it-out` plans work from plan mode to a finished
change.

## 1. Scenarios (`plan-lifecycle.test.ts`)

A simulated Claude Code or Codex session (`lib.ts`) writes a plan, puts it in
front of the person, approves or rejects it the way the tool does (the same
transcript entries, the hook called at the same moment), and runs it as an
agent would. Everything else is real: the built CLI, the hook, the
repository. Each scenario runs for both tools:

- the happy path: edits, a new file, a deletion and a check;
- the fix loop: a failing check hands back, the agent revises, the person
  approves again, the plan finishes;
- resuming with `--from`, and re-running a finished plan;
- line endings and a missing final newline;
- a file changed after approval (`E-PLAN-STALE`), a plan changed after
  approval, a rejected plan;
- the agent trying to approve its own plan three ways;
- tool-specific cases: a Claude session in a subfolder, an approval used
  twice, Codex's clear-context approval, a plan outside a git repository.

Add a scenario for every bug found in real use.

## 2. Real agents (not built yet)

Give Claude Code and Codex a spread of tasks with the skill installed and
check what they do: the plan lints, it has the `skope plan:` line, the agent
never approves its own plan, and it handles a handoff. This tests the skill's
instructions, which layer 1 can't. It costs real model calls, so it
would be opt-in.
