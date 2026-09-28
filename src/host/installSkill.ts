// `skope --install-skill [DIR]` (SPEC §7): writes skope's agent skills into Claude Code's skills
// directory, and Codex's if Codex is set up: write-skope-skill, which has an agent write skope
// skills test first; run-skope-skill, which has one run or follow a skope skill and take over a
// handoff; and skope-it-out, which has one write its plan-mode plan as a skope plan. install.sh
// and a global npm install run it for you (§5.5).

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SKILLS } from "../embedded.gen.js";
import { plainText } from "../runner/events.js";

// Previously installed copies of the old name. Leave any edited copy alone.
const OLD_PLAN_HASHES = new Set([
  "0b572c14bdc589291850d8016e3159e72390bb49f1d3ce890e5adaab9e251f75",
  "0a60e5f6c30114eda1ccdd808b6de562943e98984a01edc60ebaa4de6442f3f0",
  "b9034efaf53e2460aa1870295e4b596d313e57b9c349d19afd6f66b2aaba0e7c",
  "391dd95c6287298b50493955cb3bf1cfccc73aa830a3601e9c7fd75312fef13d",
]);

function removeOldPlanSkill(dir: string) {
  const oldDir = join(dir, "plan-with-skope");
  const oldFile = join(oldDir, "SKILL.md");
  if (!existsSync(oldFile) || !lstatSync(oldDir).isDirectory() || !lstatSync(oldFile).isFile()) return;
  if (readdirSync(oldDir).join("\n") !== "SKILL.md") return;
  const hash = createHash("sha256").update(readFileSync(oldFile)).digest("hex");
  if (!OLD_PLAN_HASHES.has(hash)) return;
  unlinkSync(oldFile);
  rmdirSync(oldDir);
}

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
    removeOldPlanSkill(dir);
  } catch (err) {
    process.stderr.write(plainText(`skope: couldn't install the skope agent skills into ${dir}: ${(err as Error).message}\n`));
    return 50;
  }
  process.stderr.write(plainText(`skope: installed the skope agent skills (${names.join(", ")}) into ${dir}\n`));
  return 0;
}
