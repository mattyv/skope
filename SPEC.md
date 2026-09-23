# skop (skill op) — Implementation Spec (v1)

Audience: an engineer or LLM implementing this from scratch. Everything
marked **MUST** is normative. Where this spec says "verify against current
docs", do so rather than guessing: some external APIs (Jev, K's IO module)
are named here from memory and may have changed.

---

## 1. What we're building

`skop` executes **dual-use skills**: Markdown files that are readable as
normal agent skills (a big LLM can read and follow them) *and* executable by a
small deterministic runtime.

- The runtime runs commands, checks facts, and asks **small typed questions**
  to a fast classifier model (**Jev** by TypeSafe) at branch points.
- When the runtime is unsure (a confidence gate fails) or something
  unexpected happens, it **hands off** to a full LLM agent with a structured
  record of what already happened.
- The agent never edits skills directly. It proposes changes as diffs for a
  human to review.

The language is defined formally in **K** (the K Framework). The K definition
is both the spec and the shipped interpreter. Everything around it (Markdown
preprocessing, the CLI wrapper, the Jev helper) is TypeScript on Node, so it's
cross-platform.

### 1.1 Goals
- Deterministic, auditable, cheap execution for the common case.
- The model can only **choose** between author-written options. It never
  writes commands, and model output never reaches a shell.
- Every skill is statically checkable: all paths terminate, all branches
  exist, worst-case cost is known before running.
- Lightweight: one CLI, logs to stdout, dry run by default.

### 1.2 Non-goals (v1)
- General-purpose programming (no arithmetic, no user functions, no
  unbounded loops, no recursion).
- Resuming a run after handoff (v1.1).
- `guarantees:` block for custom effect properties (v1.1).
- MCP server (v1.1; the CLI contract below is designed to be wrapped).
- Jev's `Score` type and multi-select (v1.1).

---

## 2. Architecture

~~~
SKILL.md ──▶ preprocessor (TS) ──▶ core program (.skc) + source map
                                        │
                     ┌──────────────────┴───────────────────┐
                     ▼                                      ▼
            K interpreter (SKILL-EXEC)             K search (SKILL-VERIFY)
            real commands, real Jev                every possible outcome
                     │                                      │
                     ▼                                      ▼
            skop wrapper (TS): logs, lock,     lint / verify report
            config, handoff to agent
~~~

Components:

| Component | Language | Responsibility |
|---|---|---|
| `preprocess` | TypeScript | Parse Markdown (CommonMark AST), validate the surface grammar, emit core syntax + source map |
| K definition | K | `SKILL-CORE` (syntax + semantics), `SKILL-EXEC` (real I/O), `SKILL-VERIFY` (nondeterministic I/O) |
| `jev-ask` | TypeScript | CLI: one question in, probabilities out. Backends: `jev`, `llm`, `fake` |
| `skop` | TypeScript | CLI wrapper: preprocess, lock, invoke K, stream logs, enforce budgets, run handoff |

---

## 3. Skill file format (surface syntax)

### 3.1 File layout
A skill is a Markdown file, conventionally `<name>/SKILL.md`. It MUST start
with YAML frontmatter. A file is runnable if and only if the frontmatter has
`format: 1`. Files without it are plain agent skills and `skop` MUST
refuse them with a clear error.

```yaml
---
name: disk-full                 # required, [a-z0-9-]+
description: ...                # required, one line (used by agents)
format: 1                       # required for runnable skills
entry: Triage                   # optional; default = first instruction section
params:                         # optional; name: default (int or string)
  mount: /
  threshold: 85
limits:                         # optional; defaults shown
  run_timeout: 30s
  jev_state: 4k tokens
  agent_tokens: 20k
  agent_turns: 5
---
```

### 3.2 Document structure
- `# Heading` (level 1): title. Prose only.
- `## Heading` (level 2): a **section**. The heading text is the section name.
  Section names MUST be unique (case-insensitive).
- Level 3+ headings are prose and belong to the enclosing section.
- A section is either:
  - an **instruction section**: contains at least one instruction (§3.3), or
  - a **data section**: contains no instructions and exactly one list (§3.6).
- Paragraphs, bold text in paragraphs, code blocks, tables, and blockquotes
  are **always prose**. The runtime ignores them; agents read them.

### 3.3 Instructions
An instruction is a **list item** whose text begins with a bold span whose
content, case-insensitively, is one of the keywords:

`run`, `do`, `check`, `ask`, `for each`, `if yes`, `then`, `page`, `hand off`

Rules:
1. Instructions are only recognised in list items that are (a) direct
   children of a list that is a direct child of an instruction section, or
   (b) nested under a `for each` or section-option `ask` item.
2. A list item starting with bold text that is **not** a keyword
   (e.g. `**Note:** ...`) is prose.
3. A list item starting with a bold keyword whose remaining text does **not**
   match the grammar in §3.4 is a **parse error**. Never fall back to treating
   it as prose. (This is the core safety property of the format.)
4. Keywords match case-insensitively (`**Run**` is the keyword `run`, and
   therefore must parse as an instruction or fail).
5. `→` and `->` are interchangeable. `·` (U+00B7) is the option separator;
   also accept ` | ` only where the grammar says so.

### 3.4 Instruction grammar (surface)
Whitespace between tokens is one or more spaces. `CMD` is exactly one inline
code span. `Q` is question text: free text that MUST NOT contain `→`, `->`,
or ` · `. `NAME` is `[a-z_][a-z0-9_]*`. `[X]` is a Markdown link-reference
style bracket naming a section (resolved case-insensitively; may also be a
real link `[text](#anchor)`, in which case the anchor text is used).

~~~ebnf
run      = "**run**" CMD [" as " NAME] [ELSE]
do       = "**do**" (CMD | NAME) [ELSE]           (* NAME must be a for-each item *)
check    = "**check**" COND (" → " TARGET [ELSE] | ELSE)
COND     = CMD " succeeds"
         | OPERAND OP OPERAND
OPERAND  = NAME | NUMBER ["%"] | "{" NAME "}" ["%"]
OP       = "<" | "<=" | ">" | ">=" | "==" | "!="
TARGET   = "stop" | "[" SECTION "]"
ELSE     = " · else " ("skip" | "[" SECTION "]")

ask      = "**ask**" Q " · sure " INT "%" [ELSE]              (* section options, nested list *)
         | "**ask**" Q " → yes | no" [" as " NAME] " · sure " INT "%" [ELSE]
         | "**ask**" Q " → one of [" LIST "] as " NAME " · sure " INT "%" [ELSE]

foreach  = "**for each**" NAME " in [" LIST "]"               (* body = nested list *)
ifyes    = "**if yes**" INLINE [ELSE]
INLINE   = "run" CMD | "do" (CMD | NAME)
then     = "**then** [" SECTION "]"
page     = "**page**" QUOTED
handoff  = "**hand off**"
~~~

Section-option `ask`: the item MUST have a nested list whose items are each
exactly one `[Section]` link and nothing else. At least 2, at most 255 options.

### 3.5 Interpolation
`{name}` may appear inside `CMD`, `Q`, `QUOTED`, and `OPERAND`.
Names resolve from: params, built-ins (`host`, `run_id`, `skill`), and
variables bound by `run … as`, `ask … as`, `for each`.

**Taint rule (MUST be enforced statically by the preprocessor):**
- *Trusted*: params, built-ins, for-each items, `one of` answers (always a
  list item), section-option choices.
- *Untrusted*: anything bound by `run … as`.
- `CMD` (in `run`, `do`, `check`) MUST NOT interpolate untrusted values.
  Violation = lint error.
- `Q` and `QUOTED` may interpolate anything. `page` text MUST be escaped
  for the pager (no mentions, no links) at runtime.
- Trusted values substituted into a `CMD` MUST be shell-quoted.

### 3.6 Data lists
A data section's single list defines a named list (name = section name).
Item forms:
- `Label — \`command\`` (em dash, or ` - `): an **action item** with a label and a command.
- `text`: a **value item** (label = value = text).

Rules:
- Item order is significant (it's the iteration order).
- `for each` MUST iterate a list of action items or value items; `do NAME`
  requires action items.
- In `Q`/`QUOTED`, `{item}` renders the label. `do item` executes its command.

### 3.7 Canonical examples
See Appendix A (`disk-full`) and Appendix B (`cert-expiry`). Both MUST be
included as test fixtures.

---

## 4. Semantics

### 4.1 Execution model
- A run starts at the `entry` section and executes instructions top to bottom.
- **Sections are states.** `then [X]`, `→ [X]`, `else [X]`, and section-option
  `ask` are **transfers**: control moves to section X and **never returns**
  (tail call). There are no returning calls in v1.
- Variables are global to the run. Rebinding a name overwrites it.
- A run ends with exactly one **outcome**:

| Outcome | Caused by | Exit code |
|---|---|---|
| `stopped` | `→ stop` | 0 |
| `paged` | `page` | 10 |
| `handoff` | `hand off`, failed gate, unhandled failure | 20 |
| `locked` | another run of this skill holds the lock | 30 |
| `invalid` | parse / lint / verify failure (nothing ran) | 40 |
| `error` | internal runner error | 50 |

- Falling off the end of an instruction section is a **lint error**
  (every path MUST end in `stop`, `page`, `hand off`, or a transfer).

### 4.2 Instructions

**`run CMD [as NAME] [else]`**: read-only command. Executed with `/bin/sh -c`
(author-written text; interpolated values are trusted and quoted), timeout
`limits.run_timeout`, stdout captured (stderr captured separately for logs).
Exit 0 → bind stdout (trimmed) to NAME if given, continue.
Non-zero or timeout → failure handling (§4.3).
MUST execute in dry-run mode too (it's diagnostics).

**`do CMD | do NAME [else]`**: side-effecting command. Same execution as
`run`, but:
- In dry run (the default), MUST NOT execute. Log a `would_do` event and
  treat it as success.
- Logged as an **effect** with `effect_start` before and `effect_end` after,
  so a crash between them leaves "effect unknown" in the log.

**`check COND → TARGET [else]`**:
- `CMD succeeds`: run CMD (read-only, same rules as `run`). True iff exit 0.
  Timeout → failure handling, not false.
- Comparison: operands coerced to numbers: trim, strip one trailing `%`,
  parse as decimal. Coercion failure → failure handling.
- True → transfer to TARGET (`stop` ends the run with `stopped`).
- False → if `else [X]`, transfer to X; `else skip` or no else → continue.
- `check COND else …` (no arrow): true → continue; false → else.

**`ask`**: one Jev call (§6).
- Build the request: question (interpolated), options, kind, context (§6.3).
- Chosen = argmax probability. Confidence = its probability.
- Confidence ≥ `sure` → proceed:
  - section options: transfer to the chosen section.
  - `yes | no`: bind NAME (default `_yn`) to boolean.
  - `one of [L] as NAME`: bind NAME to the chosen list item.
- Confidence < `sure` → gate failed:
  - no else → outcome `handoff` (reason `gate_failed`).
  - `else skip` → allowed **only** on `yes | no`: bind `false`, continue.
    On other forms it's a lint error.
  - `else [X]` → transfer to X.
- Jev unavailable → fallback backend (§6.2). If that fails too → `handoff`
  (reason `ask_unavailable`).

**`for each NAME in [L]`**: run the nested body once per item, in order,
with NAME bound to the item. A transfer or `stop` inside the body leaves the
loop and the section. After the last item, continue after the loop.

**`if yes INLINE [else]`**: execute INLINE iff the most recent `yes | no`
answer in the current section (`_yn`, or the named one if the preceding ask
used `as`) is true. INLINE failure → failure handling with the given else.

**`then [X]`**: transfer to X.

**`page QUOTED`**: interpolate, escape, invoke the configured pager command,
end with `paged`. If the pager command fails, log it, print the message to
stderr, and still end with `paged` (exit 10).

**`hand off`**: end with `handoff` (reason `explicit`). The section's prose is
the agent's instructions (§8).

### 4.3 Failure handling (run / do / check commands)
- No else → outcome `handoff` (reason `command_failed`, with exit code,
  stderr tail, timeout flag).
- `else skip` → continue; a `run … as NAME` leaves NAME **unbound**. Any
  later use of an unbound name → `handoff` (reason `unbound_variable`).
- `else [X]` → transfer to X.

### 4.4 Termination (why it's decidable)
- Loops only iterate finite author-written lists.
- The **transfer graph** between sections MUST be acyclic (lint error
  otherwise).
- Therefore every run terminates, and the number of paths is finite. K search
  (§5.4) enumerates them.

---

## 5. K definition

Verify syntax and IO hook names against the K version you install. Treat the
snippets here as shape, not copy-paste.

### 5.1 Core syntax (`.skc`), emitted by the preprocessor
Keep it LR(1) so `kompile --gen-bison-parser` works (the Bison parser is
LR(1); on conflicts it silently picks one branch).

~~~
skill "disk-full" format 1 entry triage ;
param mount = "/" ; param threshold = 85 ; param target = 80 ;
limit run_timeout = 30 ;

list cleanups = [
  action "Vacuum the journal to 500MB" cmd "journalctl --vacuum-size=500M" ,
  action "Clear the apt cache" cmd "apt-get clean"
] ;
list services = [ value "nginx" , value "rsyslog" ] ;

section triage {
  run "df --output=pcent {mount} | tail -1" as used ;
  check num used < num param threshold goto stop ;
  run "du -xh -d2 /var /tmp /home" as biggest else skip ;
  ask "What's the best next step?" sure 85 sections [ clean_up , restart , page , investigate ] ;
}
section clean_up {
  foreach step in cleanups {
    ask "Is it worth running \"{step}\"?" yesno as _yn sure 90 else skip ;
    ifyes _yn do item step else skip ;
    run "df --output=pcent {mount} | tail -1" as used ;
    check num used < num param target goto stop ;
  }
  then page ;
}
~~~

- Section names are slugified (`Clean up` → `clean_up`); the preprocessor
  keeps a display-name map.
- Every statement carries a source-map id (omitted above) so runtime errors
  and log events point at the Markdown line.

### 5.2 Modules
- **`SKILL-CORE`**: syntax, configuration, and all rules that don't touch the
  outside world: sequencing, transfers, variables, interpolation, loops, gate
  comparison, outcome recording.
- **`SKILL-EXEC`** imports CORE. Implements the three effectful operations:
  - `exec(cmd, timeout)` → `result(exit, stdout, stderr, timed_out)` via K's IO
    module (a system-call hook; in recent K this is `#system` in `K-IO`,
    verify). Timeouts: wrap the command with `timeout(1)`.
  - `ask(request)` → call the `jev-ask` CLI through the same hook, passing a
    temp file path; parse its JSON result.
  - `emit(event)` → write one JSON line to stdout.
  - If the IO hooks prove too limited, fall back to an **effect loop**: K
    rewrites to a `#request(...)` term and halts; the wrapper performs it
    (via pyk or by re-invoking the interpreter with the result injected) and
    resumes. Keep this seam in mind when writing CORE.
- **`SKILL-VERIFY`** imports CORE. Effects are nondeterministic:
  - `exec` → any of: `ok(stdout = TOKEN)`, `fail`, `timeout`.
  - Numeric comparisons on untrusted values → nondeterministically true or false.
  - `ask` → any option with `confident`, or `unsure`.
  - `emit` → appended to a `<trace>` cell.

### 5.3 Configuration cells (suggested)
~~~
<k>        $PGM </k>
<params>   .Map </params>
<env>      .Map </env>       // variables
<lists>    .Map </lists>
<sections> .Map </sections>
<effects>  .List </effects>  // do-commands executed, in order
<jevCalls> 0 </jevCalls>
<outcome>  none </outcome>
<trace>    .List </trace>    // VERIFY only
~~~

### 5.4 Build and run
- EXEC: `kompile skill-exec.k --backend llvm --gen-bison-parser`. Ship the
  `*-kompiled/` directory (interpreter + `parser_PGM`). Check `ldd` for shared
  library deps; bundle or build on the deploy base image.
- VERIFY: kompile with search enabled (check the current docs for which
  backend and flags; historically `--enable-search`) and run
  `krun --search-all` over the preprocessed fixture.
- CI builds EXEC for linux-x64, linux-arm64, and macOS-arm64.

### 5.5 Verify report (`skop --verify`)
From the search results, report:
- total paths; outcomes reachable (`stopped` / `paged` / `handoff`, with reasons)
- **fail** if any path ends without an outcome, or in `error`
- max Jev calls on any path; max `do` effects on any path
- sections never reached; ask options never taken (warnings)

---

## 6. `jev-ask` helper

### 6.1 Contract
~~~
jev-ask --request /tmp/req.json   # prints one JSON object to stdout
~~~
Request:
```json
{"kind":"choice|yesno","question":"...","options":["clean_up","restart","page"],
 "context":{"used":"91%","errors":"..."},"timeout_ms":2000}
```
Response:
```json
{"probs":{"clean_up":0.82,"restart":0.09,"page":0.09},
 "backend":"jev","model":"<model id>","ms":94}
```
Exit 0 on success; non-zero on failure (the runtime then tries fallback/handoff).
Probabilities MUST sum to ~1 (normalise if within 1e-3; otherwise error).

### 6.2 Backends (selected by config, §9)
- **`jev`**: TypeSafe Jev. Map `choice` → Jev *Choice*, `yesno` → Jev *Noul*
  (a 0–1 "is this true?" probability; derive `{"yes":p,"no":1-p}`).
  **Read TypeSafe's current API docs for request format, auth, and model
  names; do not guess.** Timeout + one retry on 5xx/timeouts.
- **`llm`**: fallback. Any LLM with structured output. Prompt it to return
  the same probability JSON. Mark `"backend":"llm"` so logs show calibration
  is weaker.
- **`fake`**: reads `--fake answers.yaml`, keyed by question text (after
  interpolation) or by source-map id; value is a probs object or the literal
  `unsure`. Used by tests and `skop --fake`.

### 6.3 Context
- Context = all variables bound so far in the run.
- Apply redaction patterns (§9) **before** anything leaves the machine.
- Truncate to `limits.jev_state` (approximate tokens as chars/4): shrink the
  largest values first, keeping their **last** lines (logs are most useful
  at the end).

---

## 7. `skop` CLI

~~~
skop <path/to/SKILL.md> [options]
  --apply              execute `do` commands (default: dry run)
  --param k=v          override a frontmatter param (repeatable, typed)
  --explain            print sections, transfer graph, and worst-case cost; run nothing
  --verify             run K search and print the verify report; run nothing
  --lint               parse + static checks only
  --fake answers.yaml  use the fake Jev backend (implies nothing else)
  --config path        default: $XDG_CONFIG_HOME/skop/config.yaml
~~~

Responsibilities, in order:
1. Preprocess + lint. On failure, print errors with file:line to stderr, exit 40.
2. Acquire lock: `flock` on `$XDG_RUNTIME_DIR/skop/<name>.lock` (or
   `/tmp/...` fallback). Held → emit `locked` event, exit 30. **Do not page.**
3. Emit `run_start`. Invoke the K interpreter. Stream its events to stdout
   unchanged.
4. Enforce a wall-clock cap (sum of worst-case timeouts + margin). Exceeded
   → kill, emit `outcome: error` with reason `wall_clock`, exit 50.
5. On `handoff`, write the handoff record (§8.1) and run the agent (§8.2),
   unless the caller is itself an agent (§8.3).
6. Exit with the outcome's code.

Linting (step 1) MUST include:
- surface grammar strictness (§3.3 rule 3)
- all `[Section]` / `[List]` references resolve; data sections used as lists,
  instruction sections used as targets
- acyclic transfer graph
- every path ends in an outcome or a transfer
- taint rule (§3.5)
- `else skip` only where allowed
- `ask` with section options has 2–255 options
- warn: `ask` whose question compares a value already bound from `run`
  (suggest `check`)

---

## 8. Handoff

### 8.1 Handoff record (JSON, written to a temp file, path logged)
```json
{"run_id":"r-8f2c","skill":"disk-full","skill_hash":"sha256:…","host":"hk-app-03",
 "section":"Triage","line":22,"reason":"gate_failed",
 "detail":{"question":"What's the best next step?",
           "probs":{"clean_up":0.55,"restart":0.40,"page":0.03,"investigate":0.02},
           "sure":85},
 "variables":{"used":"91%","errors":"…(redacted, truncated)…"},
 "effects":[{"cmd":"journalctl --vacuum-size=500M","status":"done"},
            {"cmd":"docker image prune -af","status":"unknown"}],
 "dry_run":true}
```
`effects[].status` is `done`, `failed`, `would_do` (dry run), or `unknown`
(start logged, end not).

### 8.2 Agent invocation
- Command from config (`agent.command`), e.g. a headless agent CLI.
- Prompt = **standard preamble** + skill file + handoff record.
- Enforce `limits.agent_tokens` and `limits.agent_turns` where the agent CLI
  supports it; otherwise enforce wall-clock.
- The agent's allowed actions are the skill's own commands plus read-only
  investigation. Sandboxing is out of scope for v1 but the invocation MUST
  pass `--apply` state through: in dry run, the agent is told it is in dry run.

Standard preamble (inject verbatim; don't store it in skills):
> You are taking over a run of a runnable skill. Lines in lists that start
> with a bold keyword (run, do, check, ask, for each, if yes, then, page,
> hand off) are the automated procedure; everything else is guidance for
> you. The handoff record shows what already ran and why the runtime
> stopped. Effects marked "unknown" may or may not have happened; check
> before repeating them. Don't run commands outside the skill's lists
> without a human's approval. When done, if the skill could have handled
> this automatically, propose a change to the skill as a unified diff.
> Never edit the skill file yourself.

### 8.3 Caller is an agent
If `SKOP_CALLER=agent` is set (e.g. an LLM invoked `skop` from a chat),
do **not** start a new agent. Print the handoff record to stdout as the final
event and exit 20. The calling agent handles it. This prevents agents
spawning agents.

---

## 9. Config

`$XDG_CONFIG_HOME/skop/config.yaml`. Skills never contain provider
details or secrets.

```yaml
ask:
  backend: jev            # jev | llm | fake
  model: <jev model id>
  key_env: TYPESAFE_API_KEY
  timeout_ms: 2000
  fallback: llm           # or none
llm:
  command: <cli that returns structured JSON>   # used by the llm backend
  key_env: ANTHROPIC_API_KEY
agent:
  command: <headless agent cli>
pager:
  command: <cli that takes a message on stdin>   # e.g. a Slack webhook script
redact:
  - 'AKIA[0-9A-Z]{16}'
  - '(?i)(password|secret|token)\s*[=:]\s*\S+'
```

---

## 10. Logging

- **stdout**: JSON Lines, one event per line. **stderr**: human-readable
  diagnostics only. Command output is never passed through; it's captured,
  redacted, and logged as fields.
- Every event has: `ts`, `run_id`, `skill`, `skill_hash`, `host`, `event`,
  and where applicable `section`, `line`.

| `event` | Extra fields |
|---|---|
| `run_start` | `params`, `dry_run`, `caller` |
| `run` / `check_cmd` | `cmd`, `exit`, `ms`, `timed_out`, `stdout_hash`, `stdout_tail` (redacted, ≤2KB) |
| `check` | `expr`, `left`, `right`, `result` |
| `ask` | `question`, `kind`, `probs`, `chosen`, `confidence`, `sure`, `passed`, `backend`, `model`, `ms` |
| `effect_start` / `effect_end` | `cmd`, `exit`, `ms` (end only) |
| `would_do` | `cmd` |
| `transfer` | `from`, `to` |
| `outcome` | `outcome`, `reason`, `jev_calls`, `effects` |
| `handoff_record` | `path` (or inline record when caller is agent) |
| `locked` | `holder_pid` if known |

---

## 11. Security rules (v1)
1. The model only chooses between author-written options. No model output
   is ever interpolated into a command (taint rule, enforced statically).
2. Dry run by default. `do` only executes with `--apply`.
3. The agent proposes diffs. It never writes skill files.
4. Redact before Jev, before the agent, and before logging.
5. `run`/`check` commands SHOULD be read-only. Put side effects in `do`.
   (v1 doesn't verify this; it's a review convention.)
6. Page text is escaped. A pager failure never blocks the outcome.
7. If Jev and the fallback are both down, the result is a handoff or page,
   never "act anyway".

Deliberately deferred (don't build in v1): dedicated users, sudoers
generation, skill signing, off-host log shipping.

---

## 12. Testing and acceptance

### 12.1 Fixtures
- Appendix A and B skills.
- A `fakes/` directory of answer files per fixture covering: happy path,
  every section option, gate failure, command failure, Jev unavailable.

### 12.2 Negative lint tests (each MUST fail with a line number)
- `- **Run** the tests first` (keyword, bad grammar)
- `- **run** df -h` (missing code span)
- `**do** \`rm -rf {errors}\`` where `errors` came from `run` (taint)
- a transfer cycle (`A → B → A`)
- a section that can fall off its end
- `[Nonexistent]` link
- `else skip` on a section-option ask
- an `ask` with 1 option, and with 256 options
Positive: `- **Note:** …` in an instruction list is prose; `**run**` in a
paragraph is prose.

### 12.3 Acceptance criteria
- **M1 Preprocessor**: both fixtures produce the expected `.skc` (golden
  files) with source maps; all negative tests fail with correct lines.
- **M2 K core + verify**: `--verify` on both fixtures terminates, reports
  every path ending in an outcome, and reports max Jev calls. (disk-full:
  Clean up loop is 5 items, bounded.)
- **M3 Exec with fake Jev**: for each fake file, the event stream matches a
  golden JSONL (ignoring `ts`, `ms`). Dry run executes no `do`.
- **M4 Real Jev + runner features**: lock, timeouts, redaction, fallback,
  exit codes, config.
- **M5 Handoff**: record written; agent invoked with preamble; the
  `SKOP_CALLER=agent` path returns the record instead.
- **M6 Packaging**: CI artifacts for linux-x64, linux-arm64, macOS-arm64 and
  a container image. `skop` works from a clean machine with only Node
  and the artifact.

### 12.4 Differential check (optional but cheap)
For each fake answer file, every EXEC trace MUST appear among the VERIFY
search's paths (EXEC ⊆ VERIFY). Run in CI.

---

## 13. Open questions for the implementor to raise, not decide silently
- Exact Jev API shape and model ids (read TypeSafe docs).
- Whether K's IO hooks suffice or the effect loop (§5.2) is needed.
- Which K backend and flags support search in the installed version.
- Pager integration target (Slack, PagerDuty, etc.).

---

## Appendix A — `disk-full/SKILL.md`

````markdown
---
name: disk-full
description: Free disk space safely when a Linux volume fills up. Use when a disk usage alert fires or a host is close to full.
format: 1
params:
  mount: /
  threshold: 85   # start acting above this %
  target: 80      # stop cleaning below this %
limits:
  run_timeout: 30s
  jev_state: 4k tokens
  agent_tokens: 20k
  agent_turns: 5
---

# Disk full

Free space safely when a volume fills up. Never delete anything you're
unsure about. Prefer reversible actions, and page a human rather than guess.

## Triage
Look at usage, recent errors and what's biggest on disk.

- **run** `df --output=pcent {mount} | tail -1` as used
- **check** used < {threshold}% → stop
- **run** `journalctl -p err -n 100 --no-pager` as errors
- **run** `du -xh -d2 /var /tmp /home` as biggest · else skip
- **ask** What's the best next step? · sure 85%
  - [Clean up]
  - [Restart]
  - [Page]
  - [Investigate]

## Clean up
Run cleanups least risky first. Stop as soon as usage is under target.

- **for each** step in [Cleanups]
  - **ask** Is it worth running "{step}"? → yes | no · sure 90% · else skip
  - **if yes** do step · else skip
  - **run** `df --output=pcent {mount} | tail -1` as used
  - **check** used < {target}% → stop
- **then** [Page]

## Restart
Restart the one service most likely behind the growth. Never more than one.

- **ask** Which service is behind it? → one of [Services] as service · sure 90%
- **do** `systemctl restart {service}`
- **run** `df --output=pcent {mount} | tail -1` as used
- **check** used < {threshold}% → stop
- **then** [Page]

## Page
- **page** "{host}: {mount} at {used}. Errors and biggest dirs attached."

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
````

Note: in `Page`, `{used}` may be unbound on some paths only if a `run … as
used` was skipped; here every path to Page binds it, which the linter MUST
confirm (unbound-variable analysis over paths).

---

## Appendix B — `cert-expiry/SKILL.md`

````markdown
---
name: cert-expiry
description: Check and renew TLS certificates before they expire. Use when a cert expiry alert fires or a site shows an expiring certificate.
format: 1
params:
  domain: example.com
  warn_seconds: 1209600   # 14 days
limits:
  run_timeout: 60s
  jev_state: 2k tokens
  agent_tokens: 15k
  agent_turns: 5
---

# Cert expiry

Keep TLS certificates renewed. **Never** issue a cert with a new key
unless a human asks. Renewal should be boring: dry run first, then renew,
then reload. Don't **run** certbot with `--force-renewal`; it burns rate limits.

## Triage
Check what's actually being served, then what's on disk.

- **check** `echo | openssl s_client -connect {domain}:443 -servername {domain} 2>/dev/null | openssl x509 -checkend {warn_seconds} -noout` succeeds → stop
- **check** `openssl x509 -checkend {warn_seconds} -noout -in /etc/letsencrypt/live/{domain}/cert.pem` succeeds → [Reload]
- **run** `systemctl list-timers certbot.timer --no-pager` as timer
- **run** `journalctl -u certbot -n 50 --no-pager` as renew_log
- **Note:** a stopped timer or a failed HTTP challenge are the usual causes.
- **ask** Why hasn't it renewed? · sure 85%
  - [Renew]
  - [Page]
  - [Investigate]

## Renew
Dry run first, so nothing changes if the real renewal would fail.

- **check** `certbot renew --dry-run --cert-name {domain}` succeeds · else [Investigate]
- **do** `certbot renew --cert-name {domain}`
- **then** [Reload]

## Reload
The cert on disk is fresh, so the server just needs to pick it up.

- **ask** Which server is serving {domain}? → one of [Servers] as server · sure 90%
- **do** `systemctl reload {server}`
- **check** `echo | openssl s_client -connect {domain}:443 -servername {domain} 2>/dev/null | openssl x509 -checkend {warn_seconds} -noout` succeeds → stop
- **then** [Page]

## Page
- **page** "{host}: cert for {domain} expires soon and couldn't be fixed automatically."

## Investigate
- **hand off**

Renewal is failing and the reason isn't obvious. Read the certbot log from
Triage. Common causes: DNS moved, port 80 blocked, a redirect breaking the
HTTP challenge. Don't change DNS or firewall rules without asking a human.

When you're done, suggest an edit to this skill as a diff. Don't edit the file.

## Servers
- nginx
- haproxy
````
