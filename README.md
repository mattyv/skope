# skop

**Runbooks that an agent can read and a proven runtime can run.**

A skop skill is an ordinary Markdown file. A large language model can read
it and follow it like any agent skill. skop can also *execute* it: it runs
the commands, checks the results, and asks a fast classifier small,
multiple-choice questions at the branch points. When it isn't sure, it
stops and hands the incident to a human or an agent, with a record of
everything it already did.

```markdown
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
```

Bold keywords are the program. Everything else is guidance for whoever
reads it, human or model. That section comes from
[`fixtures/disk-full/SKILL.md`](fixtures/disk-full/SKILL.md).

---

## Why

Incidents at 3am follow runbooks. Runbooks are either prose, which only a
person or an expensive agent can follow, or scripts, which can't use
judgement. skop keeps one file for both, and decides who runs each step:

- **Code runs what's certain:** measurements, comparisons, commands.
- **A classifier makes the small judgement calls,** choosing only between
  options the author wrote, and only when it's confident enough.
- **A human or agent takes over the rest,** with a record of what already
  happened.

The common case costs about a tenth of a second of classifier time per
question instead of an agent session, and every decision is logged.

## What skop guarantees

These are the design's guarantees, from [`SPEC.md`](SPEC.md). The last
column says what exists today.

| Guarantee | How | Today |
|---|---|---|
| The model only ever picks one of the author's options. It never writes a command. | The grammar has no way to express anything else; proven as P5. | specified |
| Command output never becomes part of a command. | Lint's taint rule, proven as P4. | specified |
| Dry run never executes a `do`. | Proven in Dafny over a whole run (P3). | proven for the spike |
| Every run ends, with exactly one outcome. | Proven in Dafny (P1, P2). | proven for the spike |
| Every skill is checked before it runs: no dead ends, cycles or dangling links. | The core's lint, in Dafny (P6). | two checks so far |
| A confidence number is measured, never self-reported by a model. | Jev's own distribution, or token probabilities via OpenRouter. | specified |

## How it works

```mermaid
flowchart LR
  md["SKILL.md"] --> pre["preprocess<br/>(TypeScript)"]
  pre --> core["core: lint + interpreter<br/>(Dafny, proven,<br/>compiled to JavaScript)"]
  core <--> host["host loop"]
  host <--> sh["shell commands"]
  host <--> cls["classifier<br/>(Jev or OpenRouter)"]
  host --> out(["stopped · paged · handed off"])
```

The core is a pure step function written in [Dafny](https://dafny.org):
given the state and the last result, it returns the next state and the
next request. The safety properties above are proven about that function,
then it's compiled to JavaScript and driven by a small TypeScript host. The
same interpreter runs real incidents, test fakes, and the path explorer
behind `skop --verify`.

## Status

**Early.** The language is fully specified and has been through many rounds
of outside review. Building has just started.

| Milestone | What | State |
|---|---|---|
| Phase 0 | Toolchain, CI, the Dafny → JavaScript spike, shared contracts | nearly done |
| M1 | Markdown preprocessor | next |
| M2 | Full lint and interpreter, with proofs | next |
| M3 | Runs against fake commands and answers | |
| M4 | Real backends and runner: commands, locks, redaction | |
| M5 | Handoff and paging | |
| M6 | Packaging | |
| M7 | Score questions (v1.1) | |

Today `skop --version` works, and so does the spike: a small core that
lints, runs and dry-runs `run`, `do` and `stop`, with its dry-run guarantee
proven.

## Develop

Node 20 or newer.

```console
$ npm ci
$ npm test            # builds, then runs every test
$ npm run lint        # Biome: lint and formatting
$ npx tsc --noEmit    # type check
$ node dist/cli.js --version
skop 0.1.0 (build identity 3f1c…)
```

Changing the Dafny core needs Dafny 4.11.0, the version pinned in
`.dafny-version`. The compiled JavaScript is committed, so nothing else
does.

```console
$ DAFNY=/path/to/dafny npm run core   # verify the proofs and rebuild core/generated
```

## Read more

- [`SPEC.md`](SPEC.md) is the language: syntax, semantics, proofs, backends
  and the CLI.
- [`PLAN.md`](PLAN.md) is how it's being built: phases, parallel agents,
  test-first streams, reviews and releases.
- [`contracts/`](contracts/) holds the shapes the parts of skop agree on,
  with worked examples.

## License

Licensed under either of the [Apache License, Version 2.0](LICENSE-APACHE)
or the [MIT license](LICENSE-MIT), at your option.
