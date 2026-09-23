#!/usr/bin/env node
// Generates the M3/M7 fixture fakes and golden event streams (PLAN.md §4 F,
// SPEC §12.1/§12.3) from scenarios encoded below, by hand, from the spec and
// the core JSON in contracts/examples/. This is a build tool, not a test:
// run it with `node tests/acceptance/tools/build-fixtures.mjs` to
// (re)generate fixtures/*/fakes/**, fixtures-next/*/fakes/** and
// tests/acceptance/m3/golden/**. Its output is committed; review any diff
// the way you'd review a hand-edited golden (tests/helpers/golden.ts).
//
// Every golden this script writes is listed in tests/acceptance/REVIEW.md
// for human review, per PLAN.md §4 F. In particular: `request_sha256` on
// `ask` events is a well-formed placeholder, not a real hash of a request
// payload, because the exact bytes skop-ask writes to `ask-<n>.json` aren't
// pinned by SPEC.md or contracts/ (see the note in the final report on
// SPEC §7.1/§10). `stdout_hash` values ARE real: sha256 of the fake
// command's stdout, computed below, since that's fully determined by
// commands.yaml.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const sha256 = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const PLACEHOLDER_HASH = `sha256:${"0".repeat(64)}`;

// --- envelope -----------------------------------------------------------

const ENV = { ts: "2026-09-23T00:00:00Z", run_id: "r-test", host: "test-host", skill_hash: `sha256:${"a".repeat(64)}` };

function wrap(skill, e) {
  return { ...ENV, skill, ...e };
}

// One event per kind, matching contracts/event.schema.json exactly (field
// names and which ones are required). `section`/`line` are the display
// name and the SKILL.md src line, taken straight from contracts/examples/.
const mk = {
  runStart: (skill, { params, dry_run, caller = "person" }) =>
    wrap(skill, {
      event: "run_start",
      params,
      dry_run,
      caller,
      run_dir: "/tmp/skop/runs/r-test",
      skop_version: "0.1.0",
      skop_build: "0".repeat(64),
    }),
  run: (skill, { section, line, cmd, exit, stdout, timed_out = false, after_would_do = false }) =>
    wrap(skill, {
      event: "run",
      section,
      line,
      cmd,
      exit,
      ms: 1,
      timed_out,
      truncated: false,
      stdout_hash: sha256(stdout),
      stdout_tail: stdout,
      after_would_do,
    }),
  checkCmd: (skill, { section, line, cmd, exit, stdout, timed_out = false, after_would_do = false }) =>
    wrap(skill, {
      event: "check_cmd",
      section,
      line,
      cmd,
      exit,
      ms: 1,
      timed_out,
      truncated: false,
      stdout_hash: sha256(stdout),
      stdout_tail: stdout,
      after_would_do,
    }),
  check: (skill, { section, line, expr, left, right, result, after_would_do = false }) =>
    wrap(skill, { event: "check", section, line, expr, left, right, result, after_would_do }),
  ask: (skill, { section, line, question, kind, probs, chosen, confidence, sure, passed, range, detail, after_would_do = false }) =>
    wrap(skill, {
      event: "ask",
      section,
      line,
      question,
      kind,
      probs,
      chosen,
      confidence,
      sure,
      passed,
      backend: "fake",
      model: "fake",
      ms: 1,
      request_path: "/tmp/skop/runs/r-test/ask-1.json",
      request_sha256: PLACEHOLDER_HASH,
      after_would_do,
      ...(range ? { range } : {}),
      ...(detail ? { detail } : {}),
    }),
  effectStart: (skill, { section, line, cmd }) => wrap(skill, { event: "effect_start", section, line, cmd }),
  effectEnd: (skill, { section, line, cmd, exit, timed_out = false }) =>
    wrap(skill, { event: "effect_end", section, line, cmd, exit, ms: 1, timed_out }),
  wouldDo: (skill, { section, line, cmd }) => wrap(skill, { event: "would_do", section, line, cmd }),
  page: (skill, { section, line, text, ok = true }) => wrap(skill, { event: "page", section, line, text, ok }),
  wouldPage: (skill, { section, line, text }) => wrap(skill, { event: "would_page", section, line, text }),
  handoffPage: (skill, { section, line, text, ok = true }) => wrap(skill, { event: "handoff_page", section, line, text, ok }),
  transfer: (skill, { section, line, from, to }) => wrap(skill, { event: "transfer", section, line, from, to }),
  outcome: (skill, { outcome, reason, ask_calls, effects, dry_run }) =>
    wrap(skill, { event: "outcome", outcome, reason, ask_calls, effects, dry_run }),
  handoffRecord: (skill, { section, line, record }) =>
    wrap(skill, { event: "handoff_record", section, line, path: "/tmp/skop/runs/r-test/handoff.json", record }),
};

const EXIT = { stopped: 0, paged: 10, handoff: 20, locked: 30, stale_lock: 31, invalid: 40, error: 50 };

// --- output ---------------------------------------------------------------

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function emit(fixtureDir, scenario, events, answers, commands, outcome) {
  const dir = `${ROOT}/${fixtureDir}/fakes/${scenario}`;
  write(`${dir}/answers.yaml`, `${JSON.stringify(answers, null, 2)}\n`);
  write(`${dir}/commands.yaml`, `${JSON.stringify(commands, null, 2)}\n`);
  write(`${dir}/expected-exit`, `${EXIT[outcome]}\n`);
  const jsonl = events
    .map((e) => JSON.stringify(e))
    .join("\n")
    .concat("\n");
  write(`${ROOT}/tests/acceptance/m3/golden/${fixtureDir.split("/").pop()}/${scenario}.jsonl`, jsonl);
}

// =====================================================================
// disk-full (fixtures/disk-full)
// =====================================================================

const DF = "disk-full";
const dfParams = { mount: "/", threshold: "85", target: "80" };

function dfRunStart(dry_run) {
  return mk.runStart(DF, { params: dfParams, dry_run });
}

// --- clean-up-happy: Triage -> Clean up, one cleanup accepted, stop -----
{
  const events = [
    dfRunStart(false),
    mk.run(DF, { section: "Triage", line: 23, cmd: "df --output=pcent / | tail -1", exit: 0, stdout: " 91%\n" }),
    mk.check(DF, { section: "Triage", line: 24, expr: "{used} < {threshold}%", left: "91", right: "85", result: false }),
    mk.run(DF, { section: "Triage", line: 25, cmd: "journalctl -p err -n 100 --no-pager", exit: 0, stdout: "3 disk write errors\n" }),
    mk.run(DF, { section: "Triage", line: 26, cmd: "du -xh -d2 /var /tmp /home | sort -h", exit: 0, stdout: "12G\t/var\n" }),
    mk.ask(DF, {
      section: "Triage",
      line: 27,
      question: "Given {used}, {errors} and {biggest}, what's the best next step?",
      kind: "choice",
      probs: { "s:clean_up": 0.91, "s:restart": 0.05, "s:page": 0.03, "s:investigate": 0.01 },
      chosen: "s:clean_up",
      confidence: 0.91,
      sure: 85,
      passed: true,
    }),
    mk.transfer(DF, { section: "Triage", line: 27, from: "Triage", to: "Clean up" }),
    mk.ask(DF, {
      section: "Clean up",
      line: 37,
      question: 'Given {used} and {biggest}, is it worth running "{step}"?',
      kind: "yesno",
      probs: { yes: 0.95, no: 0.05 },
      chosen: "yes",
      confidence: 0.95,
      sure: 90,
      passed: true,
    }),
    mk.effectStart(DF, { section: "Clean up", line: 38, cmd: "journalctl --vacuum-size=500M" }),
    mk.effectEnd(DF, { section: "Clean up", line: 38, cmd: "journalctl --vacuum-size=500M", exit: 0 }),
    mk.run(DF, { section: "Clean up", line: 39, cmd: "df --output=pcent / | tail -1", exit: 0, stdout: " 78%\n" }),
    mk.check(DF, { section: "Clean up", line: 40, expr: "{used} < {target}%", left: "78", right: "80", result: true }),
    mk.outcome(DF, { outcome: "stopped", reason: null, ask_calls: 2, effects: 1, dry_run: false }),
  ];
  emit(
    "fixtures/disk-full",
    "clean-up-happy",
    events,
    {
      "line:27": { "s:clean_up": 0.91, "s:restart": 0.05, "s:page": 0.03, "s:investigate": 0.01 },
      "line:37": { yes: 0.95, no: 0.05 },
    },
    {
      "line:23": { exit: 0, stdout: " 91%\n" },
      "line:25": { exit: 0, stdout: "3 disk write errors\n" },
      "line:26": { exit: 0, stdout: "12G\t/var\n" },
      "line:38": { exit: 0 },
      "line:39": { exit: 0, stdout: " 78%\n" },
    },
    "stopped",
  );
}

// --- restart-happy: Triage -> Restart -> service picked, then Page -----
{
  const events = [
    dfRunStart(false),
    mk.run(DF, { section: "Triage", line: 23, cmd: "df --output=pcent / | tail -1", exit: 0, stdout: " 93%\n" }),
    mk.check(DF, { section: "Triage", line: 24, expr: "{used} < {threshold}%", left: "93", right: "85", result: false }),
    mk.run(DF, { section: "Triage", line: 25, cmd: "journalctl -p err -n 100 --no-pager", exit: 0, stdout: "myapp-worker OOM\n" }),
    mk.run(DF, { section: "Triage", line: 26, cmd: "du -xh -d2 /var /tmp /home | sort -h", exit: 0, stdout: "40G\t/var\n" }),
    mk.ask(DF, {
      section: "Triage",
      line: 27,
      question: "Given {used}, {errors} and {biggest}, what's the best next step?",
      kind: "choice",
      probs: { "s:clean_up": 0.02, "s:restart": 0.93, "s:page": 0.03, "s:investigate": 0.02 },
      chosen: "s:restart",
      confidence: 0.93,
      sure: 85,
      passed: true,
    }),
    mk.transfer(DF, { section: "Triage", line: 27, from: "Triage", to: "Restart" }),
    mk.ask(DF, {
      section: "Restart",
      line: 46,
      question: "Given {errors} and {biggest}, which service is behind it?",
      kind: "choice",
      probs: { nginx: 0.02, rsyslog: 0.02, "myapp-worker": 0.94, "myapp-api": 0.02 },
      chosen: "myapp-worker",
      confidence: 0.94,
      sure: 90,
      passed: true,
    }),
    mk.effectStart(DF, { section: "Restart", line: 47, cmd: "systemctl restart myapp-worker" }),
    mk.effectEnd(DF, { section: "Restart", line: 47, cmd: "systemctl restart myapp-worker", exit: 0 }),
    mk.run(DF, { section: "Restart", line: 48, cmd: "df --output=pcent / | tail -1", exit: 0, stdout: " 91%\n" }),
    mk.check(DF, { section: "Restart", line: 49, expr: "{used} < {target}%", left: "91", right: "80", result: false }),
    mk.transfer(DF, { section: "Restart", line: 50, from: "Restart", to: "Page" }),
    mk.page(DF, {
      section: "Page",
      line: 55,
      text: "test-host: / at 91%. Run r-test has the errors and biggest dirs.",
      ok: true,
    }),
    mk.outcome(DF, { outcome: "paged", reason: null, ask_calls: 2, effects: 1, dry_run: false }),
  ];
  emit(
    "fixtures/disk-full",
    "restart-happy",
    events,
    {
      "line:27": { "s:clean_up": 0.02, "s:restart": 0.93, "s:page": 0.03, "s:investigate": 0.02 },
      "line:46": { nginx: 0.02, rsyslog: 0.02, "myapp-worker": 0.94, "myapp-api": 0.02 },
    },
    {
      "line:23": { exit: 0, stdout: " 93%\n" },
      "line:25": { exit: 0, stdout: "myapp-worker OOM\n" },
      "line:26": { exit: 0, stdout: "40G\t/var\n" },
      "line:47": { exit: 0 },
      "line:48": { exit: 0, stdout: " 91%\n" },
    },
    "paged",
  );
}

// --- page-direct: Triage -> Page ---------------------------------------
{
  const events = [
    dfRunStart(false),
    mk.run(DF, { section: "Triage", line: 23, cmd: "df --output=pcent / | tail -1", exit: 0, stdout: " 96%\n" }),
    mk.check(DF, { section: "Triage", line: 24, expr: "{used} < {threshold}%", left: "96", right: "85", result: false }),
    mk.run(DF, { section: "Triage", line: 25, cmd: "journalctl -p err -n 100 --no-pager", exit: 0, stdout: "no obvious cause\n" }),
    mk.run(DF, { section: "Triage", line: 26, cmd: "du -xh -d2 /var /tmp /home | sort -h", exit: 0, stdout: "spread evenly\n" }),
    mk.ask(DF, {
      section: "Triage",
      line: 27,
      question: "Given {used}, {errors} and {biggest}, what's the best next step?",
      kind: "choice",
      probs: { "s:clean_up": 0.05, "s:restart": 0.03, "s:page": 0.9, "s:investigate": 0.02 },
      chosen: "s:page",
      confidence: 0.9,
      sure: 85,
      passed: true,
    }),
    mk.transfer(DF, { section: "Triage", line: 27, from: "Triage", to: "Page" }),
    mk.page(DF, {
      section: "Page",
      line: 55,
      text: "test-host: / at 96%. Run r-test has the errors and biggest dirs.",
      ok: true,
    }),
    mk.outcome(DF, { outcome: "paged", reason: null, ask_calls: 1, effects: 0, dry_run: false }),
  ];
  emit(
    "fixtures/disk-full",
    "page-direct",
    events,
    { "line:27": { "s:clean_up": 0.05, "s:restart": 0.03, "s:page": 0.9, "s:investigate": 0.02 } },
    {
      "line:23": { exit: 0, stdout: " 96%\n" },
      "line:25": { exit: 0, stdout: "no obvious cause\n" },
      "line:26": { exit: 0, stdout: "spread evenly\n" },
    },
    "paged",
  );
}

// --- investigate-handoff: Triage -> Investigate -> hand off ------------
{
  const events = [
    dfRunStart(false),
    mk.run(DF, { section: "Triage", line: 23, cmd: "df --output=pcent / | tail -1", exit: 0, stdout: " 90%\n" }),
    mk.check(DF, { section: "Triage", line: 24, expr: "{used} < {threshold}%", left: "90", right: "85", result: false }),
    mk.run(DF, { section: "Triage", line: 25, cmd: "journalctl -p err -n 100 --no-pager", exit: 0, stdout: "unclear\n" }),
    mk.run(DF, { section: "Triage", line: 26, cmd: "du -xh -d2 /var /tmp /home | sort -h", exit: 0, stdout: "unclear\n" }),
    mk.ask(DF, {
      section: "Triage",
      line: 27,
      question: "Given {used}, {errors} and {biggest}, what's the best next step?",
      kind: "choice",
      probs: { "s:clean_up": 0.05, "s:restart": 0.03, "s:page": 0.02, "s:investigate": 0.9 },
      chosen: "s:investigate",
      confidence: 0.9,
      sure: 85,
      passed: true,
    }),
    mk.transfer(DF, { section: "Triage", line: 27, from: "Triage", to: "Investigate" }),
    mk.handoffRecord(DF, { section: "Investigate", line: 58, record: { reason: "explicit" } }),
    mk.handoffPage(DF, {
      section: "Investigate",
      line: 58,
      text: "test-host: skop disk-full handed off (explicit) in Investigate. Record: /tmp/skop/runs/r-test/handoff.json",
      ok: true,
    }),
    mk.outcome(DF, { outcome: "handoff", reason: "explicit", ask_calls: 1, effects: 0, dry_run: false }),
  ];
  emit(
    "fixtures/disk-full",
    "investigate-handoff",
    events,
    { "line:27": { "s:clean_up": 0.05, "s:restart": 0.03, "s:page": 0.02, "s:investigate": 0.9 } },
    {
      "line:23": { exit: 0, stdout: " 90%\n" },
      "line:25": { exit: 0, stdout: "unclear\n" },
      "line:26": { exit: 0, stdout: "unclear\n" },
    },
    "handoff",
  );
}

// --- gate-failure: Triage ask below sure, no else -> handoff -----------
{
  const events = [
    dfRunStart(false),
    mk.run(DF, { section: "Triage", line: 23, cmd: "df --output=pcent / | tail -1", exit: 0, stdout: " 91%\n" }),
    mk.check(DF, { section: "Triage", line: 24, expr: "{used} < {threshold}%", left: "91", right: "85", result: false }),
    mk.run(DF, { section: "Triage", line: 25, cmd: "journalctl -p err -n 100 --no-pager", exit: 0, stdout: "ambiguous\n" }),
    mk.run(DF, { section: "Triage", line: 26, cmd: "du -xh -d2 /var /tmp /home | sort -h", exit: 0, stdout: "ambiguous\n" }),
    mk.ask(DF, {
      section: "Triage",
      line: 27,
      question: "Given {used}, {errors} and {biggest}, what's the best next step?",
      kind: "choice",
      probs: { "s:clean_up": 0.5, "s:restart": 0.2, "s:page": 0.2, "s:investigate": 0.1 },
      chosen: "s:clean_up",
      confidence: 0.5,
      sure: 85,
      passed: false,
    }),
    mk.handoffRecord(DF, { section: "Triage", line: 27, record: { reason: "gate_failed" } }),
    mk.handoffPage(DF, {
      section: "Triage",
      line: 27,
      text: "test-host: skop disk-full handed off (gate_failed) in Triage. Record: /tmp/skop/runs/r-test/handoff.json",
      ok: true,
    }),
    mk.outcome(DF, { outcome: "handoff", reason: "gate_failed", ask_calls: 1, effects: 0, dry_run: false }),
  ];
  emit(
    "fixtures/disk-full",
    "gate-failure",
    events,
    { "line:27": { "s:clean_up": 0.5, "s:restart": 0.2, "s:page": 0.2, "s:investigate": 0.1 } },
    {
      "line:23": { exit: 0, stdout: " 91%\n" },
      "line:25": { exit: 0, stdout: "ambiguous\n" },
      "line:26": { exit: 0, stdout: "ambiguous\n" },
    },
    "handoff",
  );
}

// --- dry-run: Triage -> Clean up, do suppressed as would_do ------------
{
  const events = [
    dfRunStart(true),
    mk.run(DF, { section: "Triage", line: 23, cmd: "df --output=pcent / | tail -1", exit: 0, stdout: " 91%\n" }),
    mk.check(DF, { section: "Triage", line: 24, expr: "{used} < {threshold}%", left: "91", right: "85", result: false }),
    mk.run(DF, { section: "Triage", line: 25, cmd: "journalctl -p err -n 100 --no-pager", exit: 0, stdout: "3 disk write errors\n" }),
    mk.run(DF, { section: "Triage", line: 26, cmd: "du -xh -d2 /var /tmp /home | sort -h", exit: 0, stdout: "12G\t/var\n" }),
    mk.ask(DF, {
      section: "Triage",
      line: 27,
      question: "Given {used}, {errors} and {biggest}, what's the best next step?",
      kind: "choice",
      probs: { "s:clean_up": 0.91, "s:restart": 0.05, "s:page": 0.03, "s:investigate": 0.01 },
      chosen: "s:clean_up",
      confidence: 0.91,
      sure: 85,
      passed: true,
    }),
    mk.transfer(DF, { section: "Triage", line: 27, from: "Triage", to: "Clean up" }),
    mk.ask(DF, {
      section: "Clean up",
      line: 37,
      question: 'Given {used} and {biggest}, is it worth running "{step}"?',
      kind: "yesno",
      probs: { yes: 0.95, no: 0.05 },
      chosen: "yes",
      confidence: 0.95,
      sure: 90,
      passed: true,
    }),
    mk.wouldDo(DF, { section: "Clean up", line: 38, cmd: "journalctl --vacuum-size=500M" }),
    // Nothing changed (the do didn't run), so usage is unchanged: still 91%.
    mk.run(DF, {
      section: "Clean up",
      line: 39,
      cmd: "df --output=pcent / | tail -1",
      exit: 0,
      stdout: " 91%\n",
      after_would_do: true,
    }),
    mk.check(DF, {
      section: "Clean up",
      line: 40,
      expr: "{used} < {target}%",
      left: "91",
      right: "80",
      result: false,
      after_would_do: true,
    }),
    // The for_each iterates the real 5-item Cleanups list regardless of the fake answers
    // (the list itself isn't faked), so every remaining iteration still runs its own
    // ask/run/check even though the answer is "no" and no further would_do is logged.
    ...[2, 3, 4, 5].flatMap(() => [
      mk.ask(DF, {
        section: "Clean up",
        line: 37,
        question: 'Given {used} and {biggest}, is it worth running "{step}"?',
        kind: "yesno",
        probs: { yes: 0.05, no: 0.95 },
        chosen: "no",
        confidence: 0.95,
        sure: 90,
        passed: true,
        after_would_do: true,
      }),
      mk.run(DF, {
        section: "Clean up",
        line: 39,
        cmd: "df --output=pcent / | tail -1",
        exit: 0,
        stdout: " 91%\n",
        after_would_do: true,
      }),
      mk.check(DF, {
        section: "Clean up",
        line: 40,
        expr: "{used} < {target}%",
        left: "91",
        right: "80",
        result: false,
        after_would_do: true,
      }),
    ]),
    mk.transfer(DF, { section: "Clean up", line: 41, from: "Clean up", to: "Page" }),
    mk.wouldPage(DF, {
      section: "Page",
      line: 55,
      text: "test-host: / at 91%. Run r-test has the errors and biggest dirs.",
    }),
    mk.outcome(DF, { outcome: "paged", reason: null, ask_calls: 6, effects: 0, dry_run: true }),
  ];
  // The answers file can't give a line-keyed ask a different reply on each of the loop's 5
  // calls (fakes.schema.json's `answers` has no list form, unlike `commands`), so each
  // iteration is keyed by its exact rendered text instead (SPEC §3.5 / contracts/README.md):
  // trusted values pasted, run outputs named in backticks, and {step} is the loop item's
  // own trusted text.
  const cleanupItem = (label) => `Given \`used\` and \`biggest\`, is it worth running "${label}"?`;
  emit(
    "fixtures/disk-full",
    "dry-run",
    events,
    {
      "line:27": { "s:clean_up": 0.91, "s:restart": 0.05, "s:page": 0.03, "s:investigate": 0.01 },
      [cleanupItem("Vacuum the journal to 500MB")]: { yes: 0.95, no: 0.05 },
      [cleanupItem("Clear the apt cache")]: { yes: 0.05, no: 0.95 },
      [cleanupItem("Delete rotated logs older than 7 days")]: { yes: 0.05, no: 0.95 },
      [cleanupItem("Delete /tmp files older than 7 days")]: { yes: 0.05, no: 0.95 },
      [cleanupItem("Prune unused docker images")]: { yes: 0.05, no: 0.95 },
    },
    {
      "line:23": { exit: 0, stdout: " 91%\n" },
      "line:25": { exit: 0, stdout: "3 disk write errors\n" },
      "line:26": { exit: 0, stdout: "12G\t/var\n" },
      "line:39": { exit: 0, stdout: " 91%\n" },
    },
    "paged",
  );
}

console.log("wrote disk-full fakes and goldens");

// =====================================================================
// cert-expiry (fixtures/cert-expiry)
// =====================================================================

const CE = "cert-expiry";
const ceParams = { domain: "example.com", warn_seconds: "1209600" };
const ceCheckCmd =
  "echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | openssl x509 -checkend 1209600 -noout";
const ceDiskCmd = "openssl x509 -checkend 1209600 -noout -in /etc/letsencrypt/live/example.com/cert.pem";

function ceRunStart(dry_run) {
  return mk.runStart(CE, { params: ceParams, dry_run });
}

// --- stop-happy: the served cert is already fine, first check stops ----
{
  const events = [
    ceRunStart(false),
    mk.checkCmd(CE, { section: "Triage", line: 23, cmd: ceCheckCmd, exit: 0, stdout: "Certificate will not expire\n" }),
    mk.outcome(CE, { outcome: "stopped", reason: null, ask_calls: 0, effects: 0, dry_run: false }),
  ];
  emit("fixtures/cert-expiry", "stop-happy", events, {}, { "line:23": { exit: 0, stdout: "Certificate will not expire\n" } }, "stopped");
}

// --- renew-happy: served cert stale, disk cert stale too -> Renew -> Reload -> stop
{
  const events = [
    ceRunStart(false),
    mk.checkCmd(CE, { section: "Triage", line: 23, cmd: ceCheckCmd, exit: 1, stdout: "Certificate will expire\n" }),
    mk.checkCmd(CE, { section: "Triage", line: 24, cmd: ceDiskCmd, exit: 1, stdout: "Certificate will expire\n" }),
    mk.run(CE, {
      section: "Triage",
      line: 25,
      cmd: "systemctl list-timers certbot.timer --no-pager",
      exit: 0,
      stdout: "certbot.timer active\n",
    }),
    mk.run(CE, { section: "Triage", line: 26, cmd: "journalctl -u certbot -n 50 --no-pager", exit: 0, stdout: "no recent failures\n" }),
    mk.ask(CE, {
      section: "Triage",
      line: 28,
      question: "Given {timer} and {renew_log}, what's the best next step?",
      kind: "choice",
      probs: { "s:renew": 0.92, "s:page": 0.05, "s:investigate": 0.03 },
      chosen: "s:renew",
      confidence: 0.92,
      sure: 85,
      passed: true,
    }),
    mk.transfer(CE, { section: "Triage", line: 28, from: "Triage", to: "Renew" }),
    mk.effectStart(CE, { section: "Renew", line: 37, cmd: "certbot renew --dry-run --cert-name example.com" }),
    mk.effectEnd(CE, { section: "Renew", line: 37, cmd: "certbot renew --dry-run --cert-name example.com", exit: 0 }),
    mk.effectStart(CE, { section: "Renew", line: 38, cmd: "certbot renew --reuse-key --cert-name example.com" }),
    mk.effectEnd(CE, { section: "Renew", line: 38, cmd: "certbot renew --reuse-key --cert-name example.com", exit: 0 }),
    mk.transfer(CE, { section: "Renew", line: 39, from: "Renew", to: "Reload" }),
    mk.run(CE, { section: "Reload", line: 44, cmd: "ss -ltnp 'sport = :443'", exit: 0, stdout: "nginx listening\n" }),
    mk.ask(CE, {
      section: "Reload",
      line: 45,
      question: "Given {listeners}, which server is serving {domain}?",
      kind: "choice",
      probs: { nginx: 0.96, haproxy: 0.04 },
      chosen: "nginx",
      confidence: 0.96,
      sure: 90,
      passed: true,
    }),
    mk.effectStart(CE, { section: "Reload", line: 46, cmd: "systemctl reload nginx" }),
    mk.effectEnd(CE, { section: "Reload", line: 46, cmd: "systemctl reload nginx", exit: 0 }),
    mk.checkCmd(CE, { section: "Reload", line: 47, cmd: ceCheckCmd, exit: 0, stdout: "Certificate will not expire\n" }),
    mk.outcome(CE, { outcome: "stopped", reason: null, ask_calls: 2, effects: 3, dry_run: false }),
  ];
  emit(
    "fixtures/cert-expiry",
    "renew-happy",
    events,
    {
      "line:28": { "s:renew": 0.92, "s:page": 0.05, "s:investigate": 0.03 },
      "line:45": { nginx: 0.96, haproxy: 0.04 },
    },
    {
      "line:23": [
        { exit: 1, stdout: "Certificate will expire\n" },
        { exit: 0, stdout: "Certificate will not expire\n" },
      ],
      "line:24": { exit: 1, stdout: "Certificate will expire\n" },
      "line:25": { exit: 0, stdout: "certbot.timer active\n" },
      "line:26": { exit: 0, stdout: "no recent failures\n" },
      "line:37": { exit: 0 },
      "line:38": { exit: 0 },
      "line:44": { exit: 0, stdout: "nginx listening\n" },
      "line:46": { exit: 0 },
      "line:47": { exit: 0, stdout: "Certificate will not expire\n" },
    },
    "stopped",
  );
}

// --- gate-failure: Triage ask below sure, no else -> handoff -----------
{
  const events = [
    ceRunStart(false),
    mk.checkCmd(CE, { section: "Triage", line: 23, cmd: ceCheckCmd, exit: 1, stdout: "Certificate will expire\n" }),
    mk.checkCmd(CE, { section: "Triage", line: 24, cmd: ceDiskCmd, exit: 1, stdout: "Certificate will expire\n" }),
    mk.run(CE, { section: "Triage", line: 25, cmd: "systemctl list-timers certbot.timer --no-pager", exit: 0, stdout: "ambiguous\n" }),
    mk.run(CE, { section: "Triage", line: 26, cmd: "journalctl -u certbot -n 50 --no-pager", exit: 0, stdout: "ambiguous\n" }),
    mk.ask(CE, {
      section: "Triage",
      line: 28,
      question: "Given {timer} and {renew_log}, what's the best next step?",
      kind: "choice",
      probs: { "s:renew": 0.5, "s:page": 0.3, "s:investigate": 0.2 },
      chosen: "s:renew",
      confidence: 0.5,
      sure: 85,
      passed: false,
    }),
    mk.handoffRecord(CE, { section: "Triage", line: 28, record: { reason: "gate_failed" } }),
    mk.handoffPage(CE, {
      section: "Triage",
      line: 28,
      text: "test-host: skop cert-expiry handed off (gate_failed) in Triage. Record: /tmp/skop/runs/r-test/handoff.json",
      ok: true,
    }),
    mk.outcome(CE, { outcome: "handoff", reason: "gate_failed", ask_calls: 1, effects: 0, dry_run: false }),
  ];
  emit(
    "fixtures/cert-expiry",
    "gate-failure",
    events,
    { "line:28": { "s:renew": 0.5, "s:page": 0.3, "s:investigate": 0.2 } },
    {
      "line:23": { exit: 1, stdout: "Certificate will expire\n" },
      "line:24": { exit: 1, stdout: "Certificate will expire\n" },
      "line:25": { exit: 0, stdout: "ambiguous\n" },
      "line:26": { exit: 0, stdout: "ambiguous\n" },
    },
    "handoff",
  );
}

// --- dry-run: Triage -> Renew, both `do`s suppressed as would_do -------
{
  const events = [
    ceRunStart(true),
    mk.checkCmd(CE, { section: "Triage", line: 23, cmd: ceCheckCmd, exit: 1, stdout: "Certificate will expire\n" }),
    mk.checkCmd(CE, { section: "Triage", line: 24, cmd: ceDiskCmd, exit: 1, stdout: "Certificate will expire\n" }),
    mk.run(CE, {
      section: "Triage",
      line: 25,
      cmd: "systemctl list-timers certbot.timer --no-pager",
      exit: 0,
      stdout: "certbot.timer active\n",
    }),
    mk.run(CE, { section: "Triage", line: 26, cmd: "journalctl -u certbot -n 50 --no-pager", exit: 0, stdout: "no recent failures\n" }),
    mk.ask(CE, {
      section: "Triage",
      line: 28,
      question: "Given {timer} and {renew_log}, what's the best next step?",
      kind: "choice",
      probs: { "s:renew": 0.92, "s:page": 0.05, "s:investigate": 0.03 },
      chosen: "s:renew",
      confidence: 0.92,
      sure: 85,
      passed: true,
    }),
    mk.transfer(CE, { section: "Triage", line: 28, from: "Triage", to: "Renew" }),
    mk.wouldDo(CE, { section: "Renew", line: 37, cmd: "certbot renew --dry-run --cert-name example.com" }),
    mk.wouldDo(CE, { section: "Renew", line: 38, cmd: "certbot renew --reuse-key --cert-name example.com" }),
    mk.transfer(CE, { section: "Renew", line: 39, from: "Renew", to: "Reload" }),
    mk.run(CE, {
      section: "Reload",
      line: 44,
      cmd: "ss -ltnp 'sport = :443'",
      exit: 0,
      stdout: "nginx listening\n",
      after_would_do: true,
    }),
    mk.ask(CE, {
      section: "Reload",
      line: 45,
      question: "Given {listeners}, which server is serving {domain}?",
      kind: "choice",
      probs: { nginx: 0.96, haproxy: 0.04 },
      chosen: "nginx",
      confidence: 0.96,
      sure: 90,
      passed: true,
      after_would_do: true,
    }),
    mk.wouldDo(CE, { section: "Reload", line: 46, cmd: "systemctl reload nginx" }),
    // The cert on disk was never actually renewed, so the serve-side check still fails.
    mk.checkCmd(CE, {
      section: "Reload",
      line: 47,
      cmd: ceCheckCmd,
      exit: 1,
      stdout: "Certificate will expire\n",
      after_would_do: true,
    }),
    mk.transfer(CE, { section: "Reload", line: 48, from: "Reload", to: "Page" }),
    mk.wouldPage(CE, {
      section: "Page",
      line: 53,
      text: "test-host: cert for example.com expires soon and couldn't be fixed automatically.",
    }),
    mk.outcome(CE, { outcome: "paged", reason: null, ask_calls: 2, effects: 0, dry_run: true }),
  ];
  emit(
    "fixtures/cert-expiry",
    "dry-run",
    events,
    {
      "line:28": { "s:renew": 0.92, "s:page": 0.05, "s:investigate": 0.03 },
      "line:45": { nginx: 0.96, haproxy: 0.04 },
    },
    {
      "line:23": [
        { exit: 1, stdout: "Certificate will expire\n" },
        { exit: 1, stdout: "Certificate will expire\n" },
      ],
      "line:24": { exit: 1, stdout: "Certificate will expire\n" },
      "line:25": { exit: 0, stdout: "certbot.timer active\n" },
      "line:26": { exit: 0, stdout: "no recent failures\n" },
      "line:44": { exit: 0, stdout: "nginx listening\n" },
      "line:47": { exit: 1, stdout: "Certificate will expire\n" },
    },
    "paged",
  );
}

console.log("wrote cert-expiry fakes and goldens");

// =====================================================================
// error-triage (fixtures-next/error-triage, M7/v1.1)
// =====================================================================

const ET = "error-triage";

function etRunStart(dry_run) {
  return mk.runStart(ET, { params: {}, dry_run });
}

function etTriageRun(stdout) {
  return mk.run(ET, { section: "Triage", line: 18, cmd: "journalctl -p err --since -15min --no-pager", exit: 0, stdout });
}

function etAsk({ probs, chosen, confidence, passed }) {
  return mk.ask(ET, {
    section: "Triage",
    line: 19,
    question: "How severe are the errors in {errors}?",
    kind: "score",
    probs,
    chosen,
    confidence,
    sure: 75,
    passed,
    range: [1, 4],
  });
}

// --- severity 1: known noise, stop --------------------------------------
{
  const events = [
    etRunStart(false),
    etTriageRun("known benign warning x40\n"),
    etAsk({ probs: { 1: 0.9, 2: 0.05, 3: 0.03, 4: 0.02 }, chosen: 1, confidence: 0.9, passed: true }),
    mk.check(ET, { section: "Triage", line: 24, expr: "{severity} <= 1", left: "1", right: "1", result: true }),
    mk.outcome(ET, { outcome: "stopped", reason: null, ask_calls: 1, effects: 0, dry_run: false }),
  ];
  emit(
    "fixtures-next/error-triage",
    "severity-1-stop",
    events,
    { "line:19": { 1: 0.9, 2: 0.05, 3: 0.03, 4: 0.02 } },
    { "line:18": { exit: 0, stdout: "known benign warning x40\n" } },
    "stopped",
  );
}

// --- severity 2: worth a look -> Investigate -> hand off ----------------
{
  const events = [
    etRunStart(false),
    etTriageRun("elevated 5xx rate, not yet critical\n"),
    etAsk({ probs: { 1: 0.05, 2: 0.85, 3: 0.07, 4: 0.03 }, chosen: 2, confidence: 0.85, passed: true }),
    mk.check(ET, { section: "Triage", line: 24, expr: "{severity} <= 1", left: "2", right: "1", result: false }),
    mk.check(ET, { section: "Triage", line: 25, expr: "{severity} == 2", left: "2", right: "2", result: true }),
    mk.transfer(ET, { section: "Triage", line: 25, from: "Triage", to: "Investigate" }),
    mk.handoffRecord(ET, { section: "Investigate", line: 38, record: { reason: "explicit" } }),
    mk.handoffPage(ET, {
      section: "Investigate",
      line: 38,
      text: "test-host: skop error-triage handed off (explicit) in Investigate. Record: /tmp/skop/runs/r-test/handoff.json",
      ok: true,
    }),
    mk.outcome(ET, { outcome: "handoff", reason: "explicit", ask_calls: 1, effects: 0, dry_run: false }),
  ];
  emit(
    "fixtures-next/error-triage",
    "severity-2-investigate",
    events,
    { "line:19": { 1: 0.05, 2: 0.85, 3: 0.07, 4: 0.03 } },
    { "line:18": { exit: 0, stdout: "elevated 5xx rate, not yet critical\n" } },
    "handoff",
  );
}

// --- severity 4: outage -> Page ------------------------------------------
{
  const events = [
    etRunStart(false),
    etTriageRun("multiple services down, data loss risk\n"),
    etAsk({ probs: { 1: 0.01, 2: 0.02, 3: 0.07, 4: 0.9 }, chosen: 4, confidence: 0.9, passed: true }),
    mk.check(ET, { section: "Triage", line: 24, expr: "{severity} <= 1", left: "4", right: "1", result: false }),
    mk.check(ET, { section: "Triage", line: 25, expr: "{severity} == 2", left: "4", right: "2", result: false }),
    mk.transfer(ET, { section: "Triage", line: 26, from: "Triage", to: "Page" }),
    mk.page(ET, {
      section: "Page",
      line: 29,
      text: "test-host: error burst rated 4/4. Run r-test has the details.",
      ok: true,
    }),
    mk.outcome(ET, { outcome: "paged", reason: null, ask_calls: 1, effects: 0, dry_run: false }),
  ];
  emit(
    "fixtures-next/error-triage",
    "severity-4-page",
    events,
    { "line:19": { 1: 0.01, 2: 0.02, 3: 0.07, 4: 0.9 } },
    { "line:18": { exit: 0, stdout: "multiple services down, data loss risk\n" } },
    "paged",
  );
}

// --- unsure: gate fails on the Score ask -> [Unsure] -> Page ------------
{
  const events = [
    etRunStart(false),
    etTriageRun("mixed signals\n"),
    etAsk({ probs: { 1: 0.1, 2: 0.2, 3: 0.45, 4: 0.25 }, chosen: 3, confidence: 0.45, passed: false }),
    mk.transfer(ET, { section: "Triage", line: 19, from: "Triage", to: "Unsure" }),
    mk.page(ET, {
      section: "Unsure",
      line: 35,
      text: "test-host: error burst, severity unclear. Run r-test has the details.",
      ok: true,
    }),
    mk.outcome(ET, { outcome: "paged", reason: null, ask_calls: 1, effects: 0, dry_run: false }),
  ];
  emit(
    "fixtures-next/error-triage",
    "unsure",
    events,
    { "line:19": { 1: 0.1, 2: 0.2, 3: 0.45, 4: 0.25 } },
    { "line:18": { exit: 0, stdout: "mixed signals\n" } },
    "paged",
  );
}

// --- unavailable: backend down -> [Unsure] -> Page (gate else applies) --
{
  const events = [
    etRunStart(false),
    etTriageRun("errors present\n"),
    mk.ask(ET, {
      section: "Triage",
      line: 19,
      question: "How severe are the errors in {errors}?",
      kind: "score",
      probs: null,
      chosen: null,
      confidence: null,
      sure: 75,
      passed: false,
      range: [1, 4],
      detail: "unavailable",
    }),
    mk.transfer(ET, { section: "Triage", line: 19, from: "Triage", to: "Unsure" }),
    mk.page(ET, {
      section: "Unsure",
      line: 35,
      text: "test-host: error burst, severity unclear. Run r-test has the details.",
      ok: true,
    }),
    mk.outcome(ET, { outcome: "paged", reason: null, ask_calls: 1, effects: 0, dry_run: false }),
  ];
  emit(
    "fixtures-next/error-triage",
    "unavailable",
    events,
    { "line:19": "unavailable" },
    { "line:18": { exit: 0, stdout: "errors present\n" } },
    "paged",
  );
}

console.log("wrote error-triage fakes and goldens");
