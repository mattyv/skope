---
name: error-triage
description: Decide what to do about a burst of system errors. Use when an error-rate alert fires.
---

# Error triage

*A [skope](https://github.com/mattyv/skope) skill: the bold steps are the
procedure, and `{names}` in them are params, set in the skope block below.*

```skope
format: 1
limits:
  run_timeout: 30s
  ask_context: 4k tokens
```

Work out how bad a burst of errors is, then either leave it, hand it to
someone to look at, or page.

## Triage
Read the recent errors and rate how severe they are.

- **run** `journalctl -p err --since -15min --no-pager` as errors
- **ask** How severe are the errors in {errors}? → 1 to 4 as severity · sure 75% · else [Unsure]
  - 1: known noise, nothing to do
  - 2: worth a human look, not urgent
  - 3: degraded service
  - 4: outage or data at risk
- **check** {severity} <= 1 → stop
- **check** {severity} == 2 → [Investigate]
- **then** [Page]

## Page
- **page** "{host}: error burst rated {severity}/4. Run {run_id} has the details."

## Unsure
An unwatched alert shouldn't end in a handoff nobody reads. If the rating is
unclear, page.

- **page** "{host}: error burst, severity unclear. Run {run_id} has the details."

## Investigate
- **hand off**

The errors look real but not urgent. Find the cause from the errors gathered
in Triage and suggest a fix or a change to this skill as a diff.
