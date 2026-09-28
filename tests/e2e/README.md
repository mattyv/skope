# Plan-mode end-to-end tests

Three layers check that `skope-it-out` plans work from plan mode to a finished
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

## 2. Recorded real sessions (`recordings.test.ts`)

The simulation is only as good as its idea of what the tools do. Recordings
of real sessions check that idea. Each `recordings/NAME/fixture.json` holds
what a real session gave the hook, and the transcript as it was when the
hook ran and when the plan ran. CI replays each one with every command
faked.

To record one:

1. Install skope and its hooks (`skope --install-hooks`). In Codex, trust the
   hook with `/hooks`.
2. Start the tool with recording on, in a scratch repository:
   `SKOPE_RECORD=~/skope-rec claude` (or `codex`).
3. In plan mode, ask for a small change: "Use skope-it-out to plan this".
   Approve it, and let the agent run it.
4. Import it: `node scripts/import-recording.mjs ~/skope-rec claude-basic`.
   The script keeps only the transcript lines the checks read and replaces
   paths with `{{AGENT}}`, `{{REPO}}` and `{{HOME}}`.
5. Read the fixture for anything private before committing it, then
   `rm -r ~/skope-rec`.

Record again when Claude Code or Codex changes how it writes transcripts
or calls hooks, and after any change to the approval checks. A replay that
fails means real approvals would fail too.

`SKOPE_RECORD` writes the full transcript to the recording directory, mode
0600. Leave it unset otherwise.

## 3. Real agents (not built yet)

Give Claude Code and Codex a spread of tasks with the skill installed and
check what they do: the plan lints, it has the `skope plan:` line, the agent
never approves its own plan, and it handles a handoff. This tests the skill's
instructions, which layers 1 and 2 can't. It costs real model calls, so it
would be opt-in.
