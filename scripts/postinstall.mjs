#!/usr/bin/env node
// After `npm install -g skope`, installs skope's agent skills
// into Claude Code's skills directory, as install.sh does (SPEC §5.5): only
// for a global install, only if Claude Code is set up here, and never
// failing the install. SKOPE_NO_SKILL skips it. It also adds the plan-mode
// approval hook (skope --install-hooks) unless SKOPE_NO_HOOKS is set.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
  const claude = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const codex = process.env.CODEX_HOME || join(homedir(), ".codex");
  const global = process.env.npm_config_global === "true" && existsSync(cli);
  if (global && !process.env.SKOPE_NO_SKILL && existsSync(claude))
    spawnSync(process.execPath, [cli, "--install-skill"], { stdio: "inherit" });
  // The plan-mode approval hook, as install.sh adds it. SKOPE_NO_HOOKS skips it.
  if (global && !process.env.SKOPE_NO_HOOKS && (existsSync(claude) || existsSync(codex)))
    spawnSync(process.execPath, [cli, "--install-hooks"], { stdio: "inherit" });
} catch {
  // The skill is a convenience; skope itself installed fine.
}
