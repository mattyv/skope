# Design: skill tests (`skope --test`)

Status: approved. Phases 1–3 (stable keys, scripted `--test`, `--live`; SPEC §7.3) are built; 4 (`--coverage`) is not.

## Since approval: less repetition

Folder scenarios turned out verbose in practice: every scenario repeats the
shared `commands.yaml` entries, and every ask needs a full `answers.yaml`
probability table even when the scenario only cares which option won. Three
additions cut that repetition, all still under §7.3:

- **`tests.yaml`**, beside `SKILL.md`. Scenarios that don't need their own
  directory: `defaults.commands`/`defaults.answers`, then each scenario
  merges its own `commands`/`answers` over them statement by statement
  (any kind of key overrides any other for the same statement), with
  `expect.yaml`'s fields at the scenario's own top level (no `expect:`
  wrapper). A folder scenario is still exactly what it was; the two sources
  run together, sorted by name.
- **The string shorthand** in `commands.yaml` (folder or `tests.yaml`): a
  plain string or number result means `{exit: 0, stdout: <its text>}`. Most fake
  commands only ever set `stdout` on success.
- **Derived answers.** `expect.yaml`'s own `asks.<key>.chosen` already says
  what a scenario expects an ask to choose; scripting that same choice
  again in `answers.yaml` was pure duplication. Now, in scripted mode, an
  `asks` entry with no answer already covering it gets one skope scripts
  itself: the chosen option confident, the rest split evenly, so the answer
  is valid and never a tie. `--live` is untouched: it never reads
  `answers.yaml`, derived or not.

None of this changes what a scenario checks or how `--live` behaves; it
only changes how much of a scenario an author has to write by hand.

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
    scenario runs 10 times by default, and the report shows hit rate and lowest
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
`my-skill/tests/`. `--test --scenario <dir>` runs one scenario.

`fixtures/*/fakes/*/expected-exit` still works: a scenario with
`expected-exit` and no `expect.yaml` checks only the exit code. That lets
`fixtures/` become the first user of `--test` without rewriting it.

## Stable fake keys

Today a key is the exact command or question text after interpolation, or
`line:N`, and `line:N` wins when both match. This adds two keys that
survive edits:

| Key | Matches | Example |
|---|---|---|
| `Section.var` | the statement in that section that binds `var` (`run … as var`, or an `ask` that binds it) | `Counters.consumers` |
| `Section.ask` | the section's only `ask` (error if it has more than one) | `Classify.ask` |

Section names resolve by slug, the same as `[Section]` references
(SPEC §3.4), so `Counters.consumers` and `counters.consumers` are the same
key. A statement without `as` keeps using its exact text or `line:N`.
A key for "the n-th instruction" was considered and left out: it still
shifts when an instruction is inserted above it. It can come back if a real
skill needs it.

**Inside a `for each`**, a key matches the statement once per item. As
today, a list of results is used in order, and the last one repeats.

**Which key applies:**

- Under `--test`, every statement that runs must match **exactly one** key.
  Two keys matching the same statement is `E-FAKE-AMBIGUOUS`.
- In every mode, a `Section.var` or `Section.ask` key must match exactly one
  statement. A section that binds `var` twice, or has two asks, makes that
  key `E-FAKE-AMBIGUOUS`; key those statements by exact text or `line:N`.
- Under plain `--fake` / `--fake-exec`, existing files keep working:
  `Section.var` / `Section.ask`, then `line:N`, then exact text.

**Unused keys:** a key that matches no statement is `E-FAKE-UNUSED` under
`--test`, and warning `W-FAKE-UNUSED` under `--fake` / `--fake-exec`. A
stale key is how the off-by-one line bug stayed hidden. This is checked
against the program before the run, not against what the run reached.

## `expect.yaml`

Every field is optional, but a scenario must set at least one of
`outcome`, `exit`, `path` or `path_prefix`.

```yaml
outcome: paged            # stopped | paged | handoff
exit: 10                  # implied by outcome if left out
path:                     # every section entered, in order
  - Triage
  - Queue
  - Counters
  - Classify
  - Consumer too slow
# path_prefix: [Triage, Queue]   # instead of path: the run's path starts with these
asks:
  Classify:               # the section with the ask (or Section.var for one that binds)
    chosen: Consumer too slow
page_contains: "can't keep up"
handoff_reason: gate_failed   # when outcome is handoff
max_ask_calls: 1
live:                     # used only with --live
  runs: 10                # optional; default 10
  min_hit_rate: 1.0       # share of runs that must be hits (default 1.0)
  min_margin: 5           # optional: points the lowest confidence must clear `sure` by
```

**`path`** is the entry section followed by the `to` of every `transfer`
event: `[entry, ...transfer.to]`. It must match exactly. `path_prefix`
must match the start of that list. Set one or the other, not both.

**`asks.*.chosen`** is checked against the `ask` event's `chosen`, with the
section label mapped to its option id, so authors write labels, not
`s:consumer_too_slow`.

## Modes

Both modes run the skill as `--apply` with the fake command handler. No
real command runs, and the pager is faked too (SPEC §5.4), but `do`
statements go through the fake handler like any other command. A scenario
can therefore fake a `do` that fails or times out and check that the run
hands off, as the acceptance suite's `do-timeout` scenarios already do.

### Scripted: `skope SKILL.md --test`

- Commands come from `commands.yaml`. Every `ask` needs an answer in
  `answers.yaml`, and a missing one is a failure, not a live call.
- The config's backend is never contacted, so this needs no API key and
  suits CI.
- Output: one JSON line per scenario (`{"scenario","pass","mismatch"}`)
  plus a summary line. `mismatch` names the first difference: expected
  `Consumer too slow` at `Classify`, got `Consumer stuck`.

### Live: `skope SKILL.md --test --live [--runs N]`

- Commands come from `commands.yaml`. `answers.yaml` is ignored, and every
  `ask` goes to the configured backend.
- Each scenario runs 10 times by default. Two overrides, the more
  specific winning:
  - `live.runs` in a scenario's `expect.yaml` sets that scenario's count,
    e.g. fewer for a costly scenario, more for one near the gate;
  - `--runs N` on the command line sets every scenario's count for that
    invocation, over `live.runs`: `--runs 1` for a quick smoke check, more
    for a release check.

  Ten gives hit rates in 10% steps. Reassess the default once there's data
  on real providers' variance and cost.
- **A run is a hit** when it satisfies the whole `expect.yaml`: outcome,
  exit, path, every `asks.*.chosen`, `page_contains`, `handoff_reason` and
  `max_ask_calls`. An expected ask the run never reached is a miss. A
  scenario's hit rate is hits over runs, and `live.min_hit_rate` is the
  only threshold on it: with 0.8, two runs out of ten may miss in any way
  and the scenario still passes.
- Per ask, the report gives the hit rate, the lowest and median
  confidence, the margin (lowest confidence minus `sure`, in points) and
  the gate-failure count. Confidence is shown in percent, the same unit as
  `sure`:

  ```
  autoack-backlog  Classify  chosen 3/3  conf min 97% med 97%  sure 80  margin +17  PASS
  backlog          Classify  chosen 3/3  conf min 81% med 81%  sure 80  margin  +1  WARN near gate
  ```

- A scenario **fails** when its hit rate is below `live.min_hit_rate`, or
  when it sets `live.min_margin` and the margin is below it. The margin is
  taken over the runs that reached the ask. Without
  `min_margin`, a margin under 5 points is a **warning**. So the 0.81 case
  above fails CI once its scenario states a margin, and warns until then.
- Before running, skope prints the **maximum** number of backend calls:
  for each scenario, the most asks any path can reach (from the explorer,
  as `--explain` counts cost), times its runs. The exact number can't be
  known in advance: a wrong answer can lead down a path with more asks.
  The report names the backend and model, as `ask` events do.
- Live mode sends the backend exactly what a real run would: the question,
  the guidance and the named context from the fake command results, all
  redacted as usual (SPEC §9).
- Answers are never cached. A cache would hide the model drift that live
  mode exists to catch.

## Coverage (phase 4)

`--test --coverage` compares the scenarios' paths with the explorer's
paths and lists what no scenario reaches: sections, transfers, and each
ask's branches (every option, plus `unsure` and `unavailable`). The
explorer already enumerates these for `--verify`, so this is a set
difference, not new analysis.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | every scenario passed (warnings allowed) |
| 60 | at least one scenario failed |
| 40 | the skill or a scenario is invalid: lint error, bad fake or expect file, ambiguous or unused key |

60 is new. It stays clear of the run outcomes (0, 10, 20, 30, 31, 40, 50),
because a test run's code describes the tests, not a run.

## Contract changes

- `contracts/fakes.schema.json`: the new key forms.
- SPEC §7.1: `E-FAKE-UNUSED`, `W-FAKE-UNUSED`, `E-FAKE-AMBIGUOUS`.
- SPEC §7: `--test`, `--scenario`, `--live`, `--runs`, `--coverage`, and
  exit code 60. Every flag takes a fixed number of values, so the existing
  argument parser handles them.
- A new `contracts/expect.schema.json` for `expect.yaml`.

## Worked example

Queue triage with one `Classify` ask. The bug: an auto-ack consumer's ack
rate is always 0, and the question didn't say which ack mode the consumer
uses.

`tests/autoack-backlog/commands.yaml` (statements without `as` keep their
exact text as the key):

```yaml
"rabbitmq-diagnostics -q check_running": { exit: 0 }
Counters.consumers:    { exit: 0, stdout: "1" }
Counters.ready:        { exit: 0, stdout: "50000" }
Counters.unacked:      { exit: 0, stdout: "0" }
Counters.pub_rate:     { exit: 0, stdout: "40" }
Counters.deliver_rate: { exit: 0, stdout: "5" }
Counters.ack_rate:     { exit: 0, stdout: "0" }
Classify.bindings:     { exit: 0, stdout: "queue\torders\torders.#" }
Classify.ack_mode:     { exit: 0, stdout: "auto" }
```

`tests/autoack-backlog/expect.yaml`:

```yaml
outcome: paged
asks:
  Classify:
    chosen: Consumer too slow
live:
  runs: 3                 # overrides the default of 10 for this scenario
  min_hit_rate: 1.0
  min_margin: 5
```

Before the fix, `--test --live` fails: chosen 0/3, "Consumer stuck" at
87–94%. After it, the test passes: 3/3 at 97–98%. Scripted mode passes
both times, because the routing never changed. That's why the design needs
both modes.

Inserting `Classify.ack_mode` didn't move any other key. With `line:N`
keys, every key below the new line would have needed editing.

## Phasing

1. **Stable keys** (`Section.var`, `Section.ask`) and `E-FAKE-UNUSED` /
   `W-FAKE-UNUSED` / `E-FAKE-AMBIGUOUS`. Useful on their own for
   `--fake-exec`.
2. **Scripted `--test`** with `expect.yaml` and `expected-exit`
   compatibility. Move `fixtures/` onto it.
3. **`--live`** with hit rate, confidence, margin and the maximum-cost line.
4. **`--coverage`.**

Each phase starts with failing tests, as in PLAN.md.

## Decided in review

- Tests run as `--apply` with fakes, not as a dry run, so `do` failures
  and timeouts can be tested.
- An explicit `live.min_margin` fails the scenario; without one, a margin
  under 5 points warns. No `--strict` flag.
- `path` is `[entry, ...transfer.to]`; `path_prefix` is its prefix form.
- The call count shown before a live run is a maximum, from the explorer.
- Under `--test` each statement matches exactly one key; legacy precedence
  stays for plain `--fake` / `--fake-exec`.
- Left out: a pre-run check that `path` is possible (the run reports the
  mismatch anyway, and `--verify --trace` takes events, not section lists),
  the `Section#n` key, answer caching, and matching actions in `path`.
- Scenarios stay under `tests/` next to the skill.
- Live runs default to 10 per scenario. `live.runs` overrides it per
  scenario, and `--runs N` overrides both for one invocation.
- The command line is `--test [--scenario DIR] [--live] [--runs N]`: no
  flag has an optional value.
- A live hit is a run that satisfies the whole `expect.yaml`; an unreached
  expected ask is a miss; `min_hit_rate` is the only threshold on hits.
- A `Section.var` or `Section.ask` key must match exactly one statement,
  as well as each statement matching exactly one key.
