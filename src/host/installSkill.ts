// `skope --install-skill [DIR]` (SPEC §7): writes skope's agent skills into Claude Code's skills
// directory, and Codex's if Codex is set up: write-skope-skill, which has an agent write skope
// skills test first; run-skope-skill, which has one run or follow a skope skill and take over a
// handoff; and plan-with-skope, which has one write its plan-mode plan as a skope plan. install.sh
// and a global npm install run it for you (§5.5).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SKILLS } from "../embedded.gen.js";
import { plainText } from "../runner/events.js";

/** Claude Code's skills directory: $CLAUDE_CONFIG_DIR/skills, else ~/.claude/skills. */
export const defaultSkillsDir = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "skills");

/** Codex's skills directory, if Codex is set up here: $CODEX_HOME/skills, else ~/.codex/skills. */
const codexSkillsDir = () => {
  const home = process.env.CODEX_HOME || join(homedir(), ".codex");
  return existsSync(home) ? join(home, "skills") : undefined;
};

/** Without a directory: Claude Code's, and Codex's if Codex is set up. */
export function installSkill(dir?: string): number {
  if (dir !== undefined) return installInto(dir);
  const codex = codexSkillsDir();
  return Math.max(installInto(defaultSkillsDir()), codex ? installInto(codex) : 0);
}

/** Writes `<dir>/<skill>/SKILL.md` for each skill, replacing older copies. 0 on success, 50 if it can't. */
function installInto(dir: string): number {
  const names = Object.keys(SKILLS);
  try {
    for (const [name, text] of Object.entries(SKILLS)) {
      mkdirSync(join(dir, name), { recursive: true });
      writeFileSync(join(dir, name, "SKILL.md"), text);
    }
  } catch (err) {
    process.stderr.write(plainText(`skope: couldn't install the skope agent skills into ${dir}: ${(err as Error).message}\n`));
    return 50;
  }
  process.stderr.write(plainText(`skope: installed the skope agent skills (${names.join(", ")}) into ${dir}\n`));
  return 0;
}
