#!/usr/bin/env node
// Turns a recording of a real plan approval (SKOPE_RECORD=DIR, see tests/e2e/README.md) into a
// replay fixture: tests/e2e/recordings/NAME/fixture.json.
//
//   node scripts/import-recording.mjs DIR NAME [OUT]   (OUT defaults to tests/e2e/recordings)
//
// It takes the latest hook and apply recordings in DIR, keeps only the transcript lines the
// approval checks read (the ExitPlanMode call and its result for Claude Code; user messages and
// proposed plans for Codex), and replaces the agent tool's config directory, the repository and
// the home directory with {{AGENT}}, {{REPO}} and {{HOME}}. Read the fixture before committing it.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [dir, name, outRoot] = process.argv.slice(2);
if (!dir || !name || !/^[a-z0-9-]+$/.test(name)) {
  process.stderr.write("usage: node scripts/import-recording.mjs RECORDING_DIR NAME   (NAME: [a-z0-9-]+)\n");
  process.exit(40);
}
const latest = (stage) => {
  const f = readdirSync(dir)
    .filter((n) => n.includes(`-${stage}-`) && n.endsWith(".json"))
    .sort()
    .at(-1);
  return f ? JSON.parse(readFileSync(join(dir, f), "utf8")) : null;
};
const hook = latest("hook");
const apply = latest("apply");
if (!hook) {
  process.stderr.write(`no hook recording in ${dir}: approve a skope plan with SKOPE_RECORD=${dir} set\n`);
  process.exit(40);
}

const input = hook.input ?? {};
const tool = input.hook_event_name === "PostToolUse" ? "claude" : "codex";
const tp = String(hook.transcript_path ?? "");
const marker = tool === "claude" ? "/projects/" : "/sessions/";
const agent = tp.includes(marker) ? tp.slice(0, tp.indexOf(marker)) : null;
const places = [
  [agent, "{{AGENT}}"],
  [hook.root, "{{REPO}}"],
  [hook.home, "{{HOME}}"],
].filter(([from]) => from);
const anon = (v) => {
  let s = JSON.stringify(v);
  for (const [from, to] of places.sort((a, b) => b[0].length - a[0].length)) s = s.split(from).join(to);
  return JSON.parse(s);
};

/** Only the transcript lines the approval checks read. */
function trim(text) {
  if (typeof text !== "string") return null;
  const keep = text.split("\n").filter((line) => {
    if (!line.trim()) return false;
    if (tool === "claude") return line.includes("ExitPlanMode") || (input.tool_use_id && line.includes(input.tool_use_id));
    try {
      const s = JSON.stringify(JSON.parse(line));
      return s.includes('"role":"user"') || s.includes("<proposed_plan>");
    } catch {
      return false;
    }
  });
  return `${keep.join("\n")}\n`;
}

const fixture = anon({
  tool,
  recorded_at: new Date().toISOString().slice(0, 10),
  session_cwd: hook.cwd,
  hook: input,
  transcript_at_hook: trim(hook.transcript),
  transcript_at_apply: apply ? trim(apply.transcript) : null,
  plan_path: hook.plan_path,
  plan: hook.plan,
  files: hook.files ?? {},
});

const out = join(outRoot ?? join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "e2e", "recordings"), name);
if (existsSync(join(out, "fixture.json"))) {
  process.stderr.write(`${out}/fixture.json exists; pick another NAME\n`);
  process.exit(40);
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "fixture.json"), `${JSON.stringify(fixture, null, 2)}\n`);
process.stderr.write(
  `wrote ${out}/fixture.json (${tool}; transcript lines at hook ${fixture.transcript_at_hook?.split("\n").length - 1 ?? 0}, at apply ${
    fixture.transcript_at_apply ? fixture.transcript_at_apply.split("\n").length - 1 : "none"
  }). Read it for anything private before committing.\n`,
);
