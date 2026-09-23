# Goldens needing human review

Stream F wrote these event-stream goldens by hand from SPEC.md and the core
JSON in `contracts/examples/` (PLAN.md §4 F: "reviewed by a human, since
these are the ground truth for M3"). They're generated (not hand-typed) by
`tests/acceptance/tools/build-fixtures.mjs`, which encodes the same
by-hand reasoning as code so ~20 scenarios stay internally consistent; treat
its scenario definitions as the thing to review, the same way you'd review
a hand-edited `.jsonl` file. Re-run it after any edit
(`node tests/acceptance/tools/build-fixtures.mjs`) and diff the result.

Known caveats to check first:

- **`ask.request_sha256` is a placeholder**, not a real hash
  (`sha256:0000…0000` on every ask event). The golden helper
  (`tests/helpers/golden.ts`) does **not** ignore this field — only `ts`,
  `ms`, `run_id`, `host`, `skill_hash`, `run_dir`, `request_path`, `path`,
  `file`, `skop_version` and `skop_build` are dropped. But the exact bytes
  `skop-ask` writes to `ask-<n>.json` (key order, number formatting,
  trailing whitespace) aren't pinned by SPEC.md or any contract, so no
  golden can state the real hash today. Flagged in the final stream F
  report as a spec/contract gap; the two options are (a) add
  `request_sha256` to the golden helper's ignore list, alongside
  `skop_version`/`skop_build`, or (b) pin the exact JSON serialisation in
  `contracts/ask.schema.json`'s description. Whichever is chosen, every
  golden here needs its `ask` lines re-verified (or the ignore list
  extended) once real requests exist.
- **`stdout_hash` values are real** — sha256 of the exact fake `stdout`
  string in the matching `commands.yaml` entry — so they should already be
  correct; spot-check a couple by hand if anything looks off after an edit.
- **`yes`/`no` are assumed as the option ids for a `yesno` ask** (so
  `probs`/`chosen` on those events use the strings `"yes"`/`"no"`). SPEC.md
  doesn't name these ids explicitly (§4.2 just says "bind NAME to
  boolean"); `contracts/README.md` doesn't cover it either. If stream C/D
  picks different ids, the `yesno` events in every scenario need updating.
- **Ordinary `check` events' `expr` field** is the literal source text of
  the comparison (e.g. `"{used} < {threshold}%"`), copied from SKILL.md by
  hand for each occurrence; `left`/`right` are the coerced decimal values.
  This matches the one example in `contracts/examples/events.jsonl` but
  hasn't been cross-checked against a second implementation.
- **`transfer`/`handoff_record`/`handoff_page` line numbers on gate
  failure and Score-gate-failure-via-`else`** point at the `ask`
  statement's own `src` line (matching `contracts/examples/events.jsonl`'s
  gate-failure example). Double-check this against the real host once it
  exists — it's the natural reading but not spelled out as a rule.
- **`disk-full/fakes/dry-run` and `cert-expiry/fakes/dry-run`** are the
  most elaborate scenarios (a full `for_each` loop, or two `do`s and a
  second real check after suppression) and are the most likely to have a
  transcription slip. Worth a careful line-by-line read against SPEC §4.5.
- **Deadline scenarios are not included.** SPEC §12.1 lists "deadline" as
  a required scenario category per fixture; none of the fifteen scenarios
  here exercise `limits.deadline`. `commands.yaml`'s `ms` field is
  documented as advancing the host's simulated clock for exactly this
  purpose, but SPEC.md doesn't say what `section`/`line` a deadline
  handoff reports (the deadline is checked *between* steps, so it isn't
  tied to any one instruction) — raised as a spec gap in the final report.
  Recommend a human/stream-G decision on the reported line before adding
  these.
- **`do`-timeout and generic `command_failed` are only covered for
  disk-full** (`gate-failure`'s Triage `run` has no timeout variant; there
  is no dedicated `command-failure` or `do-timeout` scenario in this set —
  `restart-happy` and `renew-happy` cover the happy `do` path only). Left
  as follow-up scope; noted in the final report.
- **cert-expiry has no direct "already-renewed-on-disk, reload only"
  scenario** (Triage's second `check` transferring straight to Reload
  without going through the ask). `stop-happy` only exercises the first
  check. Left as follow-up scope.

## Scenario index

| Fixture | Scenario | What it covers |
|---|---|---|
| disk-full | `clean-up-happy` | Triage → Clean up, one cleanup accepted, stop |
| disk-full | `restart-happy` | Triage → Restart, service picked and restarted, then Page |
| disk-full | `page-direct` | Triage → Page directly |
| disk-full | `investigate-handoff` | Triage → Investigate → hand off (explicit) |
| disk-full | `gate-failure` | Triage ask below `sure`, no else → handoff (gate_failed) |
| disk-full | `dry-run` | `--dry-run`: one `would_do`, full 5-item loop, `would_page` |
| cert-expiry | `stop-happy` | First check succeeds → stop, no ask |
| cert-expiry | `renew-happy` | Triage → Renew (two `do`s) → Reload → stop |
| cert-expiry | `gate-failure` | Triage ask below `sure` → handoff (gate_failed) |
| cert-expiry | `dry-run` | `--dry-run`: two `would_do`s in Renew, second check still fails, Page |
| error-triage | `severity-1-stop` | Score level 1 → stop |
| error-triage | `severity-2-investigate` | Score level 2 → Investigate → hand off |
| error-triage | `severity-4-page` | Score level 4 → Page |
| error-triage | `unsure` | Score gate fails (0.45 top, below 75% sure) → Unsure → Page |
| error-triage | `unavailable` | Backend unavailable on the Score ask → Unsure → Page |
