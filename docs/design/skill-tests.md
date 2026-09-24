# Design: skill tests (`skope --test`)

Status: draft, for discussion. Nothing here is built yet.

## Problem

A skill author can rehearse a skill today (`--fake`, `--fake-exec`) and
check which paths it can take (`--verify`, `--verify --trace`). What they
can't do is **say what should happen and have skope check it**. Every
rehearsal ends in a person reading JSON lines.

This came from converting an RMQ triage runbook into a skill, where the
testing loop was by hand:

1. A shell loop ran each scenario 3 times, and `jq` pulled out the chosen
   option, which a person then compared against what they expected.
2. The loop caught a real bug. For a consumer that auto-acks, the ack rate
   is always 0, and the backend chose "Consumer stuck" at 0.87–0.94. That
   clears `sure 80%`, so the skill would have paged the wrong cause. Tests
   with scripted answers can't catch this. The routing was right; the
   question and its evidence were wrong.
3. The same loop showed one correct answer scoring 0.81–0.83 against
   `sure 80%`. That passes today but is likely to fail the gate on some real
   runs. Nothing reports how close an answer is to the gate.
4. Fake files keyed by `line:N` broke twice. One key was off by one line,
   and inserting a step shifts every key below it. Keys by exact command
   text break instead when a param default changes.

The pieces are there: fake handlers, the explorer, the event stream, and
`expected-exit` in `fixtures/`. But `expected-exit` is read only by skope's
own acceptance tests, not by any command a skill author can run.

## Goals

- Scenarios live next to the skill and state the expected **path**,
  **outcome** and **answers**. `skope --test` runs them and exits non-zero
  on any mismatch.
- Two modes:
  - **Scripted** (answers faked): free, deterministic, fast, and suitable
    for CI. It tests the logic: checks, thresholds and routing.
  - **Live** (real backend, commands faked): tests the questions. Each
    scenario runs N times, and the report shows hit rate and lowest
    confidence against `sure`.
- Fake keys that survive editing: keyed by section and variable name, not
  by line number.
- No real command ever runs, and no page is ever sent, in either mode.

## Non-goals

- Mocking the backend's reasoning, or judging answers beyond "was the
  expected option chosen, and how confidently".
- Testing real commands, which is an integration concern. A test that
  needs the real broker is a `--dry-run`, not a `--test`.
- Changing the core or its proofs. The test runner is host-side: it drives
  the existing core and reads the existing events.

## Layout

```
my-skill/
  SKILL.md
  tests/
    backlog/
      commands.yaml     # required: fakes.schema.json "commands"
      answers.yaml      # scripted mode: fakes.schema.json "answers"
      expect.yaml       # required: what must happen
    stuck/
      ...
```

`skope my-skill/SKILL.md --test` runs every directory under
`my-skill/tests/`. `--test <dir>` runs one scenario.

`fixtures/*/fakes/*/expected-exit` still works: a scenario with
`expected-exit` and no `expect.yaml` checks only the exit code. That lets
`fixtures/` become the first user of `--test` without rewriting it.

## Stable fake keys

Today a key is the exact command or question text after interpolation, or
`line:N`, and `line:N` wins when both match. This adds two keys that
survive edits:

| Key | Matches | Example |
|---|---|---|
| `Section.var` | the `run … as var` (or `ask … as var`) in that section | `Counters.consumers` |
| `Section#n` | the n-th instruction in that section, 1-based, for statements with no `as` | `Triage#1` |
| `Section.ask` | the section's only `ask` (error if it has more than one) | `Classify.ask` |

Section names resolve by slug, the same as `[Section]` references
(SPEC §3.4), so `Counters.consumers` and `counters.consumers` are the same
key.

Precedence, most specific first: `Section.var` / `Section.ask`, then
`Section#n`, then `line:N`, then exact text. Existing fake files keep
working unchanged.

Checks on fake files, reported before the run:

- A key that matches no statement is `E-FAKE-UNUSED` under `--test`, and
  warning `W-FAKE-UNUSED` under `--fake` / `--fake-exec`. A stale key is
  how the off-by-one line bug stayed hidden.
- Two keys that match the same statement are `E-FAKE-AMBIGUOUS`.

## `expect.yaml`

Every field is optional, but a scenario must set at least one of
`outcome`, `exit` or `path`.

```yaml
outcome: paged            # stopped | paged | handoff
exit: 10                  # implied by outcome if left out
path:                     # sections entered, in order; exact unless `prefix: true`
  - Triage
  - Queue
  - Counters
  - Classify
  - Consumer too slow
asks:
  Classify:               # section with the ask (or Section.var for a `one of` / yes-no ask)
    chosen: Consumer too slow
page_contains: "can't keep up"
handoff_reason: gate_failed   # when outcome is handoff
max_ask_calls: 1
live:                     # used only with --live
  runs: 5
  min_hit_rate: 1.0       # share of runs that must choose `chosen`
  min_margin: 5           # points the lowest confidence must clear `sure` by
```

`path` is checked against the `transfer` events. `asks.*.chosen` is
checked against the `ask` event's `chosen`, with the section label mapped
to its option id, so authors write labels, not `s:consumer_too_slow`.

A scenario is also checked **before it runs**. Its `path` must be one the
explorer can take (reusing `--verify --trace`), so a scenario that expects
an impossible path is reported as broken instead of as a failing run.

## Modes

### Scripted: `skope SKILL.md --test`

- Commands come from `commands.yaml`. Every `ask` needs an answer in
  `answers.yaml`, and a missing one is a failure, not a live call.
- The config's backend is never contacted, so this needs no API key and
  suits CI.
- Output: one JSON line per scenario (`{"scenario","pass","mismatch"}`)
  plus a summary line. `mismatch` names the first difference: expected
  `Consumer too slow` at `Classify`, got `Consumer stuck`.

### Live: `skope SKILL.md --test --live [N]`

- Commands come from `commands.yaml`. `answers.yaml` is ignored, and every
  `ask` goes to the configured backend.
- Each scenario runs `N` times (default: `live.runs`, else 3).
- Per ask, the report gives the hit rate, the lowest and median
  confidence, the margin (lowest confidence minus `sure`) and the
  gate-failure count:

  ```
  autoack-backlog  Classify  chosen 3/3  conf min 0.97 med 0.97  sure 80  margin +17  PASS
  backlog          Classify  chosen 3/3  conf min 0.81 med 0.81  sure 80  margin  +1  WARN near gate
  ```

- A scenario fails when its hit rate is below `live.min_hit_rate`. It gets
  a warning when the margin is below `live.min_margin` (default 5 points).
  The warning is how the 0.81 case above would have been caught.
- Before running, skope prints the number of calls it will make (`asks
  reached × N × scenarios`) and the model it will use. Live results depend
  on the model, so the report includes the backend and model, the same as
  `ask` events do.

## Coverage (phase 2)

`--test --coverage` compares the scenarios' paths with the explorer's
paths and lists what no scenario reaches: sections, transfers, and each
ask's branches (every option, plus `unsure` and `unavailable`). The
explorer already enumerates these for `--verify`, so this is a set
difference, not new analysis.

## Safety

- `--test` implies the fake command handler. A command with no fake result
  fails the scenario (`E-FAKE-UNMATCHED`). No real command runs, and the
  pager is never called.
- `--test` never runs a `do`, whether or not it's a dry run. Scenarios
  still check that the path reaches a `do` (`would_do` events).
- Live mode sends the backend exactly what a real run would: the question,
  the guidance and the named context from the fake command results, all
  redacted as usual (SPEC §9). Fake results are author-written, but they
  go through redaction too.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | every scenario passed (warnings allowed) |
| 60 | at least one scenario failed |
| 40 | the skill or a scenario is invalid: lint error, bad fake or expect file, impossible path |

60 is new. It stays clear of the run outcomes (0, 10, 20, 30, 31, 40, 50),
because a test run's code describes the tests, not a run.

## Worked example

Queue triage with one `Classify` ask. The bug: an auto-ack consumer's ack
rate is always 0, and the question didn't say which ack mode the consumer
uses.

`tests/autoack-backlog/commands.yaml`:

```yaml
Triage#1:          { exit: 0 }
Queue#1:           { exit: 0 }
Counters.consumers: { exit: 0, stdout: "1" }
Counters.ready:     { exit: 0, stdout: "50000" }
Counters.unacked:   { exit: 0, stdout: "0" }
Counters.pub_rate:  { exit: 0, stdout: "40" }
Counters.deliver_rate: { exit: 0, stdout: "5" }
Counters.ack_rate:  { exit: 0, stdout: "0" }
Classify.bindings:  { exit: 0, stdout: "queue\torders\torders.#" }
Classify.ack_mode:  { exit: 0, stdout: "auto" }
```

`tests/autoack-backlog/expect.yaml`:

```yaml
outcome: paged
asks:
  Classify:
    chosen: Consumer too slow
live:
  runs: 3
  min_hit_rate: 1.0
```

Before the fix, `--test --live` fails: chosen 0/3, "Consumer stuck" at
0.87–0.94. After it, the test passes: 3/3 at 0.97–0.98. Scripted mode
passes both times, because the routing never changed. That's why the
design needs both modes.

Inserting `Classify.ack_mode` didn't move any other key. With `line:N`
keys, every key below the new line would have needed editing.

## Phasing

1. **Stable keys** and `E-FAKE-UNUSED` / `W-FAKE-UNUSED` / `E-FAKE-AMBIGUOUS`.
   Useful on their own for `--fake-exec`.
2. **Scripted `--test`** with `expect.yaml`, `expected-exit` compatibility,
   and the pre-run path check. Move `fixtures/` onto it.
3. **`--live`** with hit rate, confidence and margin.
4. **`--coverage`.**

Each phase starts with failing tests, as in PLAN.md.

## Open questions

1. Should `Section#n` count only instructions, or prose items too? Counting
   instructions only is more stable, and this draft assumes it.
2. Should live mode cache answers by request hash so reruns cost nothing?
   It would hide model drift, so maybe only behind a flag.
3. Is there a better home for scenarios than `tests/` inside the skill
   directory? Agent skill loaders ignore subdirectories, so it's safe
   there, but it ships with the skill.
4. Should `path` also match on actions (`would_do`, `would_page`), or is
   `page_contains` enough?
5. Should a live WARN near the gate fail CI under a `--strict` flag?
