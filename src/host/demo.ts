// `skope --demo [DIR]` (SPEC §7): writes the disk-full skill with its tests and fakes into DIR,
// default ./skope-demo, and prints what to try. Nothing it suggests runs a real command or needs
// an API key.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO } from "../embedded.gen.js";
import { plainText } from "../runner/events.js";

/** 0 once written, 40 if DIR already exists (it never overwrites), 50 if it can't write. */
export function writeDemo(dir = "skope-demo"): number {
  const say = (s: string) => process.stderr.write(plainText(`${s}\n`));
  if (existsSync(dir)) {
    say(`skope: ${dir} already exists; give --demo another directory`);
    return 40;
  }
  try {
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(DEMO)) writeFileSync(join(dir, name), text);
  } catch (err) {
    say(`skope: couldn't write the demo into ${dir}: ${(err as Error).message}`);
    return 50;
  }
  const skill = join(dir, "SKILL.md");
  say(`skope: wrote a demo skill into ${dir}. Nothing below runs a real command or needs an API key.

  skope ${skill} --verify     # every path the skill can take, and how each ends
  skope ${skill} --test       # its unit tests, from ${join(dir, "tests.yaml")}
  skope ${skill} --dry-run --fake ${join(dir, "answers.yaml")} --fake-exec ${join(dir, "commands.yaml")}
                              # one run, as JSON events, with faked commands and model`);
  return 0;
}
