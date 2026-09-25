#!/usr/bin/env node
// After `npm install -g skope`, installs skope's agent skills
// into Claude Code's skills directory, as install.sh does (SPEC §5.5): only
// for a global install, only if Claude Code is set up here, and never
// failing the install. SKOPE_NO_SKILL skips it.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
  const claude = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  if (process.env.npm_config_global === "true" && !process.env.SKOPE_NO_SKILL && existsSync(claude) && existsSync(cli))
    spawnSync(process.execPath, [cli, "--install-skill", join(claude, "skills")], { stdio: "inherit" });
} catch {
  // The skill is a convenience; skope itself installed fine.
}
