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
- **New scenarios flagged in the task are now added** (this pass, on top of
  the earlier `error-triage/severity-3-page`): per-fixture
  backend-unavailable/invalid-response scenarios on a **choice** ask
  (`ask-unavailable`, `ask-invalid`, disk-full and cert-expiry), a `do`
  timeout (`do-timeout`), a `command_failed` without an `else`
  (`command-failed`), a `deadline` scenario using `commands.yaml`'s `ms`
  field (`deadline`), a tie via `unassigned` (`tie-unassigned`),
  disk-full's line 26 (`du … · else skip`) actually failing so `biggest`
  is unbound (`unbound-biggest`), and cert-expiry's Page/Investigate
  options (`page-direct`, `investigate-handoff`) beyond what
  `gate-failure`/`renew-happy` already exercise. A secret-redaction pin
  (`disk-full/secret-redaction`) is also added. See the scenario index
  below for what each one covers, and the final report (or this pass's
  commit) for the modelling choices behind them — in particular:
  - `deadline` uses each skill's *default* `limits.deadline` (15m /
    900000ms, SPEC §3.1 — neither fixture's frontmatter overrides it) and
    a `commands.yaml` `ms: 1000000` on the first instruction, rather than
    editing frontmatter (out of this pass's scope). The handoff's
    `section`/`line` is the next instruction that didn't start (SPEC §7
    step 5), which for both fixtures is the very next line after the one
    the huge `ms` was attached to.
  - `unbound-biggest` renders the ask's unbound name as `(unavailable)`
    per SPEC §3.5 ("A name used in `Q` or `QUOTED` that may be unbound
    renders as `(unavailable)`") — this is not actually ambiguous in
    SPEC.md, despite the note this file used to carry.
  - `tie-unassigned` uses dyadic `A=0.5, B=0.25, unassigned=0.25` as in
    the task brief. At every `sure` value the two fixtures actually use
    (75–90%), a tie-causing `unassigned` share can only appear together
    with the chosen option *also* being below `sure` (the remaining
    budget for "any other option + unassigned" tops out at `1 - chosen`,
    so `chosen ≤ 0.5` is required for a tie to be reachable at all, which
    is already below every `sure` these skills use) — so this scenario
    necessarily exercises the tie mechanism and the below-`sure` gate
    failure together, not the tie in isolation. A skill with `sure` ≤ 50%
    would be needed to isolate it, and neither fixture has one.
  - `command_failed`'s and `deadline`'s handoff-record `detail` shape
    isn't pinned by SPEC §8.1 the way `gate_failed`/`ask_unavailable`'s
    is (there's no worked example). For `command_failed` this pass uses
    `{cmd, exit, timed_out, stderr_tail}` (matching §4.3's "exit code,
    stderr tail, timeout flag"); `explicit` and `deadline` get `detail: null`
    (SPEC §8.1; stream G changed this from omitting it). Confirm this shape
    against the real core's output once it exists.
  - The redaction replacement text (`"[REDACTED]"` in
    `secret-redaction`) isn't specified by SPEC §9 either; that section
    says only that built-in patterns are redacted, never what they're
    replaced with.

## Scenario index

| Fixture | Scenario | What it covers |
|---|---|---|
| disk-full | `clean-up-happy` | Triage → Clean up, one cleanup accepted, stop |
| disk-full | `restart-happy` | Triage → Restart, service picked and restarted, then Page |
| disk-full | `page-direct` | Triage → Page directly |
| disk-full | `investigate-handoff` | Triage → Investigate → hand off (explicit) |
| disk-full | `gate-failure` | Triage ask below `sure`, no else → handoff (gate_failed) |
| disk-full | `dry-run` | `--dry-run`: one `would_do`, full 5-item loop, `would_page` |
| disk-full | `ask-unavailable` | Backend unavailable on the Triage (choice) ask → handoff (ask_unavailable), exit 20 |
| disk-full | `ask-invalid` | Triage ask's probs don't sum to 1 → same as backend unavailable |
| disk-full | `do-timeout` | Restart's `do` (no else) times out → effect unknown → handoff (command_failed) |
| disk-full | `command-failed` | Triage's `run` (line 25, no else) fails → handoff (command_failed) |
| disk-full | `deadline` | Huge simulated `ms` exceeds `limits.deadline` → handoff (deadline) before the next step |
| disk-full | `tie-unassigned` | Triage ask ties via `unassigned` (0.5/0.25/…/0.25) → handoff (gate_failed) |
| disk-full | `unbound-biggest` | Line 26's `du … · else skip` fails; Triage ask's question shows `biggest` as `(unavailable)` |
| disk-full | `secret-redaction` | A secret in `errors`' stdout is redacted in `stdout_tail` and `record.variables` |
| cert-expiry | `stop-happy` | First check succeeds → stop, no ask |
| cert-expiry | `renew-happy` | Triage → Renew (two `do`s) → Reload → stop |
| cert-expiry | `gate-failure` | Triage ask below `sure` → handoff (gate_failed) |
| cert-expiry | `dry-run` | `--dry-run`: two `would_do`s in Renew, second check still fails, Page |
| cert-expiry | `ask-unavailable` | Backend unavailable on the Triage (choice) ask → handoff (ask_unavailable), exit 20 |
| cert-expiry | `ask-invalid` | Triage ask's probs don't sum to 1 → same as backend unavailable |
| cert-expiry | `do-timeout` | Renew's second `do` (line 38, no else) times out → handoff (command_failed) |
| cert-expiry | `command-failed` | Triage's `run` (line 25, no else) fails → handoff (command_failed) |
| cert-expiry | `deadline` | Huge simulated `ms` exceeds `limits.deadline` → handoff (deadline) before the next step |
| cert-expiry | `tie-unassigned` | Triage ask ties via `unassigned` (0.5/0.25/0/0.25) → handoff (gate_failed) |
| cert-expiry | `page-direct` | Triage → Page directly |
| cert-expiry | `investigate-handoff` | Triage → Investigate → hand off (explicit) |
| error-triage | `severity-1-stop` | Score level 1 → stop |
| error-triage | `severity-2-investigate` | Score level 2 → Investigate → hand off |
| error-triage | `severity-3-page` | Score level 3 → Page (falls through, same as level 4) |
| error-triage | `severity-4-page` | Score level 4 → Page |
| error-triage | `unsure` | Score gate fails (0.375 top, below 75% sure) → Unsure → Page |
| error-triage | `unavailable` | Backend unavailable on the Score ask → handoff (ask_unavailable), exit 20 |
