---
name: disk-full
description: Free disk space safely when a Linux volume fills up. Use when a disk usage alert fires or a host is close to full.
---

# Disk full

*A [skope](https://github.com/mattyv/skope) skill. Run it with `skope` (see the run-skope-skill skill),
never by hand: its commands are reviewed as a set. `{names}` are params, set in the skope block below.*

```skope
format: 1
params:
  mount: /
  threshold: 85   # start acting above this %
  target: 80      # stop cleaning below this %
limits:
  run_timeout: 30s
  do_timeout: 10m
  ask_context: 4k tokens
```

Free space safely when a volume fills up. Never delete anything you're
unsure about. Prefer reversible actions, and page a human rather than guess.

## Triage
Look at usage, recent errors and what's biggest on disk.

- **run** `df --output=pcent {mount} | tail -1` as used
- **check** {used} < {threshold}% → stop
- **run** `journalctl -p err -n 100 --no-pager` as errors
- **run** `du -xh -d2 /var /tmp /home | sort -h` as biggest · else skip
- **ask** Given {used}, {errors} and {biggest}, what's the best next step? · sure 85%
  - [Clean up]
  - [Restart]
  - [Page]
  - [Investigate]

## Clean up
Run cleanups least risky first. Stop as soon as usage is under target.

- **for each** step in [Cleanups]
  - **ask** Given {used} and {biggest}, is it worth running "{step}"? → yes | no · sure 90% · else skip
  - **if yes** do step · else skip
  - **run** `df --output=pcent {mount} | tail -1` as used
  - **check** {used} < {target}% → stop
- **then** [Page]

## Restart
Restart the one service most likely behind the growth. Never more than one.

- **ask** Given {errors} and {biggest}, which service is behind it? → one of [Services] as service · sure 90%
- **do** `systemctl restart {service}`
- **run** `df --output=pcent {mount} | tail -1` as used
- **check** {used} < {target}% → stop
- **then** [Page]

## Page
Nothing here is safe to try automatically. Tell a human.

- **page** "{host}: {mount} at {used}. Run {run_id} has the errors and biggest dirs."

## Investigate
- **hand off**

Nothing in the lists fits. Work out what's filling the disk from the
errors and sizes gathered in Triage. Don't run anything outside
[Cleanups] or [Services] without asking a human first.

When you're done, suggest an edit to this skill (a new cleanup, a new
service, or a new option in Triage) as a diff. Don't edit the file.

## Cleanups
Least risky first.

1. Vacuum the journal to 500MB — `journalctl --vacuum-size=500M`
2. Clear the apt cache — `apt-get clean`
3. Delete rotated logs older than 7 days — `find /var/log -name '*.gz' -mtime +7 -delete`
4. Delete /tmp files older than 7 days — `find /tmp -type f -mtime +7 -delete`
5. Prune unused docker images — `docker image prune -af`

## Services
- nginx
- rsyslog
- myapp-worker
- myapp-api
