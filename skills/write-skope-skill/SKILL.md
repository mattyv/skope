---
name: write-skope-skill
description: Write or change a skope skill (a runbook in Markdown that skope can run and an agent can follow), test first. Use when asked to turn a runbook, incident notes or an on-call procedure into a skope skill, to add a case to an existing skill, or to fix a skill that chose wrong.
---

# Writing a skope skill, test first

A skope skill is a Markdown runbook that two things can use: an agent reads
and follows it, and `skope` runs it, asking Jev only the judgement calls.
Because skope can run it, it can be tested like code. Write the tests
first, then the skill, then check the questions against the real model.

Never run a skill with `--apply` while writing it. Everything below uses
fakes or read-only modes.

## 1. Collect the cases before writing anything

From the runbook, incident notes or the person asking, list the situations
the skill must handle. For each: what the commands would show, what should
happen, and what a human would decide at each judgement call. Always
include:

- the **happy path** for each branch (each option of each `ask`),
- the **false alarm** (a check that should stop the run early),
- **a command failing** and **a `do` failing or timing out**,
- **the model being unsure**, which must hand off or page, never guess,
- the **"none of these fit"** case, which should hand off.

If a case needs a fact you don't have (a threshold, a service name, what
"safe" means here), ask the person. Don't invent operational policy.

## 2. Write the scenarios: `tests.yaml`, beside `SKILL.md`

```yaml
defaults:
  commands:
    Triage.used: "93%\n"            # key by Section.var; a string is {exit: 0, stdout: ...}
    Triage.errors: "myapp-worker OOM\n"
    "systemctl restart myapp-worker": { exit: 0 }   # a do that binds nothing: key by its text
scenarios:
  restart:
    outcome: stopped                # stopped | paged | handoff
    path: [Triage, Restart]         # sections entered, in order
    asks:                           # expected choices; scripted tests answer them for you
      Triage: { chosen: Restart }
      Restart.service: { chosen: myapp-worker }
  false-alarm:
    commands: { Triage.used: "40%\n" }
    outcome: stopped
    path: [Triage]
  restart-fails:
    commands:
      "systemctl restart myapp-worker": { exit: null, timed_out: true }
    asks:
      Triage: { chosen: Restart }
      Restart.service: { chosen: myapp-worker }
    outcome: handoff
    handoff_reason: command_failed
  none-fit:
    asks: { Triage: { chosen: Investigate } }
    outcome: handoff
    path: [Triage, Investigate]
  unsure:
    answers: { Triage.ask: unsure } # a tie: the gate fails
    outcome: handoff
    handoff_reason: gate_failed
```

- **Keys:** use `Section.var` for a `run … as var`, and `Section.ask` for a
  section's only question. Use the exact command text for a statement that
  binds nothing. These keys survive edits; avoid `line:N`.
- **Answers:** naming an ask's expected choice in `asks` is enough; skope
  scripts that answer. Give `answers` only for `unsure`, `unavailable`, or a
  deliberately low-confidence answer.
- **Also available:** `path_prefix`, `page_contains`, `max_ask_calls`,
  `exit`.

## 3. Red

```console
$ skope SKILL.md --test
```

With no skill yet, or before the new case exists, the scenarios must fail
or be invalid. If a new scenario passes before you change the skill, it
isn't testing the change: fix the scenario.

## 4. Write the skill

````markdown
---
name: disk-full
description: Free disk space safely when a volume fills up. Use when a disk alert fires.
---

# Disk full

*A [skope](https://github.com/mattyv/skope) skill. Run it with `skope` (see the run-skope-skill skill),
never by hand: its commands are reviewed as a set. `{names}` are params, set in the skope block below.*

```skope
format: 1
params:
  mount: /
  threshold: 85
```

One paragraph of intent: what "safe" means, what never to do.

## Triage
What this section is for. This paragraph is shown to Jev as guidance.

- **run** `df --output=pcent {mount} | tail -1` as used
- **check** {used} < {threshold}% → stop
- **run** `journalctl -p err -n 100 --no-pager` as errors
- **ask** Given {used} and {errors}, what's the best next step? · sure 85%
  - [Restart]
  - [Investigate]

## Restart
Restart the one service the errors point at. Never more than one.

- **ask** Given {errors}, which service is behind it? → one of [Services] as service · sure 90%
- **do** `systemctl restart {service}`
- **stop**

## Investigate
The errors don't point at one service, or nothing here fits.

- **hand off**

Prose here is the handoff's instructions for the person or agent who
takes over.

## Services
- nginx
- myapp-worker
````

Layout: the frontmatter holds only `name` and `description` (and other
Agent Skills keys). `format: 1`, params and limits go in the `skope` block,
because agents never see frontmatter and claude.ai rejects unknown keys
there. Keep the note line under the title: it tells an agent that loads the
skill what the bold steps are.

Keywords: **run**, **do**, **check**, **ask**, **for each**, **if yes**,
**then**, **page**, **hand off**, **stop**. A bold word that isn't a
keyword is an error. Ask forms: a list of `[Section]` options; `→ yes | no`
(then **if yes**); `→ one of [List] as x`; `→ 1 to 4 as x` with a rubric.
Failure handling: `· else skip` or `· else [Section]`; without one, a
failure hands off. Action lists are `1. Label — \`command\``, and
`- **for each** step in [List]` with `**if yes** do step` runs them.

Rules that keep a skill safe and testable:

- **Code decides what's certain.** Measure with `run`, compare with
  `check`. Never ask the model for a number or a threshold.
- **One judgement per question.** Split "is it X and Y?" into two asks.
- **Put the deciding fact in the question's evidence.** The model only
  sees the `run` outputs the question names, as `{var}`. If the answer
  depends on something the question can't see, the model is confidently
  wrong and the gate won't catch it. If it matters, `run` it and name it.
- **Always offer an escape.** A choice list needs an option that hands off
  or pages ("Investigate"), for when none fit.
- **Prefer yes/no over a Score level for a single threshold.** A Score's
  confidence runs high; gate on yes/no instead.
- **`do` only what's reversible or explicitly approved,** and only
  interpolate params and list items into commands. Command output can
  never go into a command (`E-TAINT`): output could hold `; rm -rf /`.
  To act on what a command found, let an `ask` pick from a list you wrote
  (`→ one of [Services] as service`, then `do systemctl restart {service}`).
- **No arithmetic: do the maths in the command.** `check` only compares
  (`<`, `<=`, `>`, `>=`, `==`, `!=`) a variable with a number or another
  variable. Compute inside one command, e.g.
  `` `free -m | awk '/Mem/ {print int($3*100/$2)}'` as mem_pct ``, with
  params allowed (`awk -v t={threshold}`). You can't combine two earlier
  outputs in a command (`$(( {a} - {b} ))` is `E-TAINT`): measure both in
  one command, or compare them with `check {after} < {before}`.
- **Every section ends** in `stop`, `page`, `hand off` or `then [X]`.

## 5. Check, then green

```console
$ skope SKILL.md --lint        # grammar, taint, reachability: must be clean
$ skope SKILL.md --verify      # every path and how it ends: read it
$ skope SKILL.md --test        # every scenario must pass
```

`--verify` lists every path. Each ending the runbook cares about should
have a scenario. Add any that are missing and go back to step 3.

## 6. Check the questions against the real model

Scripted tests prove the routing, not the questions. With a backend
configured:

```console
$ skope SKILL.md --test --live --runs 5
```

For each ask it reports how often the model chose what the scenario
expects, its lowest and median confidence, and the margin over `sure`.

- **Wrong choices:** the question is missing evidence or is ambiguous. Add
  the deciding fact (another `run`, named in the question), sharpen the
  wording or the options' guidance paragraphs, and run again. Don't lower
  `sure` to make a wrong answer pass.
- **Right but a thin margin (under 5 points):** set `sure` from the
  lowest confidence you saw, a few points under, or improve the evidence.
  Once settled, add `live: { min_margin: 5 }` to the scenario so CI-run
  live tests catch drift.
- Live runs cost real backend calls; skope prints the maximum before it
  starts.

## 7. Before you finish

- `--lint`, `--test` and `--verify` are clean, and live results are
  reported to the person, including any thin margins.
- Show the person the skill and `tests.yaml`, and say which cases are
  covered and what you assumed.
- Show them `skope SKILL.md --effects`, the full list of commands the skill
  could run, and point out any you added or changed. **Never run
  `--approve` yourself:** approving the scope is the person's decision.
- Changing an existing skill: add or change the scenario first (red), then
  the skill (green). Never change a scenario's expectations just to make
  it pass without saying why.

Reference: the skope README, and `docs/SPEC.md` §3–4 (language) and §7.3
(tests) in the skope repository.
