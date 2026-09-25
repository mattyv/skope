// `skope --install-skill [DIR]` (SPEC §7): writes the write-skope-skill agent skill, which has an
// agent write skope skills test first, into Claude Code's skills directory. install.sh and a
// global npm install run it for you (§5.5).

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { WRITE_SKOPE_SKILL } from "../embedded.gen.js";
import { plainText } from "../runner/events.js";

/** Claude Code's skills directory: $CLAUDE_CONFIG_DIR/skills, else ~/.claude/skills. */
export const defaultSkillsDir = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "skills");

/** Writes `<dir>/write-skope-skill/SKILL.md`, replacing an older copy. 0 on success, 50 if it can't. */
export function installSkill(dir = defaultSkillsDir()): number {
  const to = join(dir, "write-skope-skill");
  try {
    mkdirSync(to, { recursive: true });
    writeFileSync(join(to, "SKILL.md"), WRITE_SKOPE_SKILL);
  } catch (err) {
    process.stderr.write(plainText(`skope: couldn't install the write-skope-skill skill into ${to}: ${(err as Error).message}\n`));
    return 50;
  }
  process.stderr.write(plainText(`skope: installed the write-skope-skill skill into ${to}\n`));
  return 0;
}
