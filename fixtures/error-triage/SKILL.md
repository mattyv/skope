---
name: error-triage
description: Decide what to do about a burst of system errors. Use when an error-rate alert fires.
---

# Error triage

*A [skope](https://github.com/mattyv/skope) skill. Run it with `skope` (see the run-skope-skill skill),
never by hand: its commands are reviewed as a set. `{names}` are params, set in the skope block below.*

```skope
format: 1
limits:
  run_timeout: 30s
  ask_context: 4k tokens
```

Work out how bad a burst of errors is, then either leave it, hand it to
someone to look at, or page.

## Triage
Read the recent errors and decide how to handle them.

- **run** `journalctl -p err --since -15min --no-pager` as errors
- **ask** Given {errors}, how should this burst be handled? · sure 75% · else [Unsure]
  - [Noise]
  - [Investigate]
  - [Page]

## Noise
Known noise: nothing is wrong and there's nothing to do.

- **stop**

## Investigate
Worth a human look, but not urgent: nothing is degraded yet.

- **hand off**

The errors look real but not urgent. Find the cause from the errors gathered
in Triage and suggest a fix or a change to this skill as a diff.

## Page
Degraded service, an outage, or data at risk.

- **page** "{host}: error burst needs attention. Run {run_id} has the details."

## Unsure
An unwatched alert shouldn't end in a handoff nobody reads. If the call is
unclear, page.

- **page** "{host}: error burst, handling unclear. Run {run_id} has the details."
