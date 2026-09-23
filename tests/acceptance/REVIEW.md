# Goldens needing human review

Stream F wrote these event-stream goldens by hand from SPEC.md and the core
JSON in `contracts/examples/` (PLAN.md §4 F: "reviewed by a human, since
these are the ground truth for M3"). They're generated (not hand-typed) by
`tests/acceptance/tools/build-fixtures.mjs`, which encodes the same
by-hand reasoning as code so ~20 scenarios stay internally consistent; treat
its scenario definitions as the thing to review, the same way you'd review
a hand-edited `.jsonl` file. Re-run it after any edit
(`node tests/acceptance/tools/build-fixtures.mjs`) and diff the result.

This pass (post external-review, SPEC rev 18) fixed:
- **G1**: `handoff_record.record` now carries the full SPEC §8.1 shape
  (`skill`, `section`, `line`, `reason`, `detail` for `gate_failed`/
  `ask_unavailable` asks, `variables`, `effects`, `dry_run`, `skop`,
  `preamble` — the §8.2 text verbatim), not the `{reason}` stub it used to
  be. `tests/helpers/golden.ts` still ignores `record.run_id`/`host`/
  `skill_hash`/`skop`.
- **G2**: event order in every scenario is `handoff_record`, then
  `handoff_page` if it pages, then `outcome` last (already the order the
  generator produced; this pass re-checked it against SPEC §8). Not
  reviewed: `contracts/examples/events.jsonl`'s own order, which is outside
  this pass's file list.
- **G3**: page/handoff_page text embeds the run's actual host, run_id and
  run dir; `tests/helpers/golden.ts` now replaces those exact substrings
  (taken from the stream's own `run_start`) with `<host>`/`<run_id>`/
  `<run_dir>` before comparing, so goldens don't need to hardcode
  `test-host`/`r-test`/`/tmp/skop/runs/r-test` to match a real run.
- **G4**: `check.expr` is now `{used} < {threshold}` (no decorative `%`),
  matching "rendered from the core program" (SPEC §10).
- **G5**: `ask.question` is the question **as sent** (SPEC §3.5): names
  bound by `run` are backticked (`` `used` ``, `` `errors` ``, `` `biggest` ``,
  `` `timer` ``, `` `renew_log` ``, `` `listeners` ``), trusted values
  (params, list items) are pasted in — including each `for each` iteration's
  own item label, e.g. `is it worth running "Clear the apt cache"?`, and
  `example.com` (the `domain` param) pasted into cert-expiry's Reload
  question.
- **Gate-failure/passing probabilities are dyadic everywhere** (halves,
  quarters, eighths, sixteenths, thirty-seconds), so `probs` sums to
  exactly 1 in IEEE doubles and the golden helper's normalisation is exact.
  A passing ask uses `0.875/0.0625/.../` (7/8 for the chosen option); a
  failing one uses `0.5/0.25/0.125/0.125` (disk-full/error-triage) or
  `0.5/0.3125/0.1875` (cert-expiry, 3 options) — well under `sure`.
- **error-triage `unavailable`**: previously routed through the ask's own
  `else [Unsure]` and paged (exit 10). Fixed: the backend being unavailable
  is `ask_unavailable`, a handoff reason in its own right (SPEC §8.1),
  distinct from `gate_failed`/the else clause — SPEC §5.4 explicitly says
  "Unsure and unavailable differ: with `else [Page]`, unsure pages but
  unavailable hands off." The scenario now hands off, exit 20, with
  `probs`/`chosen`/`confidence` null and `detail: "unavailable"` on the
  `ask` event, and `reason: "ask_unavailable"` on the handoff record.
- **M1/M7 split**: error-triage (Appendix D, v1.1) is no longer linted in
  `tests/acceptance/m1/lint-cli.test.ts`'s M1 loop (that's the v1 fixture
  pair only); its `--lint` coverage moved into
  `tests/acceptance/m7/score-fixture-coverage.test.ts`.
- **M7 severity coverage**: added `severity-3-page` (error-triage has no
  explicit `check` for level 3; it falls through the same as level 4, to
  `[Page]`) so all four Score levels have a scenario, per SPEC §12.1
  ("Its fakes cover each level").
- **M3 dry run**: `exec.test.ts` now asserts no `effect_start`/`effect_end`
  and no `page`/`handoff_page` on dry-run scenarios (there is no `do` event
  kind in SPEC §10 — dry run suppresses a `do` as `would_do`), and every
  scenario now also asserts the process exit code against `expected-exit`.
- **M2 differential check**: `differential.test.ts` now drives the real
  `--verify --trace <events.jsonl>` flag from §12.4 instead of an invented
  `--verify --json` "paths" listing, using the trace file format's actual
  shape (an ordinary events.jsonl). It builds the trace from each
  scenario's own M3 run (via `runSkop`), not from the golden, and checks
  both that a real run's trace is accepted (exit 0) and that a truncated
  one is rejected (exit 40). The stray `"hand_off"` entry (not a real event
  kind) is gone from the event-kind filter.
- **P1**: `tests/acceptance/lib/cli.ts`'s `runSkop` now builds a clean,
  disposable environment per call — a fresh temp dir supplies
  `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and `XDG_RUNTIME_DIR`, which also
  fixes lock collisions between parallel test runs at
  `$XDG_RUNTIME_DIR/skop/<name>.lock` (SPEC §7 step 3). `SKOP_CALLER` is
  stripped from the inherited environment unless a test sets it. Unless a
  test passes its own `--config`, a config is written with a harmless pager
  (`pager.command: "cat > /dev/null"`, so `page`/`handoff_page` events come
  back `ok: true`) and a fixed `state_dir`.

Known caveats still open:

- **`ask.request_sha256` is a placeholder**, not a real hash
  (`sha256:0000…0000` on every ask event), same as before — see the
  original note below.
- **`stdout_hash` values are real** — sha256 of the exact fake `stdout`
  string in the matching `commands.yaml` entry.
- **`yes`/`no` are assumed as the option ids for a `yesno` ask.** SPEC.md
  doesn't name these ids explicitly (§4.2 just says "bind NAME to
  boolean"). If stream C/D picks different ids, the `yesno` events in every
  scenario need updating.
- **`transfer`/`handoff_record`/`handoff_page` line numbers on gate
  failure and Score-gate-failure-via-`else`** point at the `ask`
  statement's own `src` line, matching `contracts/examples/events.jsonl`.
- **New scenarios flagged in the task are only partly added.** This pass
  added `error-triage/severity-3-page`. Still missing, called out
  explicitly by the review and left as follow-up scope: per-fixture
  backend-unavailable/invalid-response scenarios on a **choice** ask (only
  error-triage's Score ask has one), a `do` timeout, a `command_failed`
  without an `else`, a `deadline` scenario using `commands.yaml`'s `ms`
  field, disk-full's line 26 (`du … · else skip`) actually failing so
  `biggest` is unbound, a tie via `unassigned`, and cert-expiry's
  Page/Investigate options beyond what `gate-failure`/`renew-happy` already
  exercise. A secret-redaction pin (a fake's stdout containing something
  that should be redacted, checked in `stdout_tail` and
  `record.variables`) is also not yet added. SPEC §7's `deadline` handoff
  section/line ("the instruction the run would have started next") still
  needs a human/implementor decision on exactly which line that is when
  the deadline is checked between steps, not at one.

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
| error-triage | `severity-3-page` | Score level 3 → Page (falls through, same as level 4) |
| error-triage | `severity-4-page` | Score level 4 → Page |
| error-triage | `unsure` | Score gate fails (0.375 top, below 75% sure) → Unsure → Page |
| error-triage | `unavailable` | Backend unavailable on the Score ask → handoff (ask_unavailable), exit 20 |
