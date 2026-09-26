// A skill's scope and its approval (SPEC §7.4): every command it could run, listed before it
// runs; and, with an approvals directory, nothing runs until a person approves exactly that list.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { CoreProgram } from "../../src/contracts.gen.js";
import { diffEffects, effectsOf } from "../../src/host/effects.js";
import { preprocess } from "../../src/preprocess/index.js";
import { runSkope } from "../acceptance/lib/cli.js";
import { ROOT } from "../acceptance/lib/scenarios.js";

function program(md: string): CoreProgram {
  const r = preprocess(md);
  if (!("program" in r)) throw new Error(JSON.stringify(r.errors));
  return r.program;
}
const DISK_FULL = readFileSync(`${ROOT}/fixtures/disk-full/SKILL.md`, "utf8");
const skill = (body: string, block = "") =>
  `---\nname: tiny\ndescription: t\n---\nA skope skill.\n\`\`\`skope\nformat: 1\n${block}\`\`\`\n\n## Main\nDo it.\n\n${body}\n`;

describe("effectsOf", () => {
  test("disk-full: every command, list variables expanded, params left as {name}", () => {
    const e = effectsOf(program(DISK_FULL));
    const lines = e.commands.map((c) => `${c.kind} ${c.cmd}`);
    expect(lines).toEqual([
      "do apt-get clean",
      "do docker image prune -af",
      "do find /tmp -type f -mtime +7 -delete",
      "do find /var/log -name '*.gz' -mtime +7 -delete",
      "do journalctl --vacuum-size=500M",
      "do systemctl restart myapp-api",
      "do systemctl restart myapp-worker",
      "do systemctl restart nginx",
      "do systemctl restart rsyslog",
      "run df --output=pcent {mount} | tail -1",
      "run du -xh -d2 /var /tmp /home | sort -h",
      "run journalctl -p err -n 100 --no-pager",
    ]);
    expect(e.commands.find((c) => c.cmd.startsWith("df "))?.sections).toEqual(["Triage", "Clean up", "Restart"]);
    expect(e.params).toEqual({ mount: "/", threshold: 85, target: 80 });
    expect(e.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("a list variable reaches a command in another section; check … succeeds and if yes count", () => {
    const md = skill(
      "- **ask** Which? → one of [Envs] as env · sure 80%\n- **check** `ping -c1 {env}` succeeds → [Go]\n- **stop**\n\n## Go\nGo.\n\n- **run** `echo ok`\n- **ask** Deploy? → yes | no · sure 90%\n- **if yes** do `deploy {env}` · else skip\n- **stop**\n\n## Envs\n- staging\n- prod",
    );
    expect(effectsOf(program(md)).commands.map((c) => `${c.kind} ${c.cmd}`)).toEqual([
      "do deploy prod",
      "do deploy staging",
      "run echo ok",
      "run ping -c1 prod",
      "run ping -c1 staging",
    ]);
  });

  test("the hash pins what can run, not prose, questions, sure or where", () => {
    const base = effectsOf(program(DISK_FULL)).hash;
    const reworded = DISK_FULL.replace("Look at usage, recent errors", "Check usage, recent errors").replace("sure 85%", "sure 95%");
    expect(effectsOf(program(reworded)).hash).toBe(base);
    const newItem = DISK_FULL.replace("- myapp-api", "- myapp-api\n- postgres");
    expect(effectsOf(program(newItem)).hash).not.toBe(base);
    expect(diffEffects(effectsOf(program(DISK_FULL)), effectsOf(program(newItem)))).toEqual(["+ do   systemctl restart postgres"]);
  });
});

describe("--effects, --approve and E-NOT-APPROVED", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "skope-scope-"));
    const xdg = join(dir, "config");
    mkdirSync(join(xdg, "skope"), { recursive: true });
    const approvals = join(dir, "approvals");
    writeFileSync(join(xdg, "skope", "config.yaml"), `approvals: ${approvals}\n`);
    const skillPath = join(dir, "SKILL.md");
    copyFileSync(`${ROOT}/fixtures/disk-full/SKILL.md`, skillPath);
    for (const f of ["answers.yaml", "commands.yaml"]) copyFileSync(`${ROOT}/fixtures/disk-full/demo/${f}`, join(dir, f));
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: join(dir, "state") };
    const dry = () =>
      runSkope([skillPath, "--dry-run", "--fake", join(dir, "answers.yaml"), "--fake-exec", join(dir, "commands.yaml")], { env });
    return { dir, approvals, skillPath, env, dry };
  }

  test("--effects needs no approval and runs nothing; its JSON has the hash and every command", async () => {
    const { skillPath, env } = setup();
    const r = await runSkope([skillPath, "--effects"], { env });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("disk-full can run 12 commands, 9 of them changing things");
    const report = JSON.parse(r.stdout.trim()) as { effects_hash: string; commands: unknown[] };
    expect(report.effects_hash).toBe(effectsOf(program(DISK_FULL)).hash);
    expect(report.commands).toHaveLength(12);
  });

  test("unapproved, a dry run refuses before running anything; approved, it runs; a new command refuses again", async () => {
    const { approvals, skillPath, env, dry } = setup();
    const before = await dry();
    expect(before.code).toBe(40);
    expect(before.stderr).toContain("E-NOT-APPROVED: disk-full has no approval");
    expect(before.events.some((e) => e.event === "run")).toBe(false);

    const ok = await runSkope([skillPath, "--approve"], { env });
    expect(ok.code).toBe(0);
    const approval = JSON.parse(readFileSync(join(approvals, "disk-full.json"), "utf8"));
    expect(approval).toMatchObject({ skill: "disk-full", effects_hash: effectsOf(program(DISK_FULL)).hash });
    expect((await dry()).code).toBe(0);

    // Rewording keeps the approval.
    writeFileSync(skillPath, DISK_FULL.replace("Look at usage, recent errors", "Check usage, recent errors"));
    expect((await dry()).code).toBe(0);

    // A new command doesn't.
    writeFileSync(
      skillPath,
      DISK_FULL.replace("- **do** `systemctl restart {service}`", "- **do** `systemctl restart {service}`\n- **do** `rm -rf /var/cache`"),
    );
    const changed = await dry();
    expect(changed.code).toBe(40);
    expect(changed.stderr).toContain("E-NOT-APPROVED: disk-full's commands changed since it was approved (+ do   rm -rf /var/cache)");

    const again = await runSkope([skillPath, "--approve"], { env });
    expect(again.code).toBe(0);
    expect(again.stderr).toContain("changes since the last approval: + do   rm -rf /var/cache");
  });

  test("--approve with no approvals directory configured is E-CONFIG", async () => {
    const r = await runSkope([`${ROOT}/fixtures/disk-full/SKILL.md`, "--approve"], {
      env: { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "skope-xdg-")) },
    });
    expect(r.code).toBe(40);
    expect(r.stderr).toContain("--approve needs an approvals directory in the config");
  });

  test("--test fakes every command, so it doesn't need an approval", async () => {
    const { dir, env } = setup();
    for (const f of ["tests.yaml"]) copyFileSync(`${ROOT}/fixtures/disk-full/demo/${f}`, join(dir, f));
    const r = await runSkope([join(dir, "SKILL.md"), "--test"], { env });
    expect(r.code).toBe(0);
  });
});
