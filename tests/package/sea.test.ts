// M6 packaging (SPEC §5.5, PLAN.md §8): scripts/package/sea.mjs builds a
// Node single executable application from the bundle. This builds one
// locally (embedding the running Node, per the script's own default) and
// checks it prints the same `--version` as the npm build and runs a fake
// scenario with its expected exit code, with `node` removed from PATH.
//
// Skips (with the reason) only when this platform's Node can't build a
// single executable application at all. A binary that builds but doesn't
// run is a failure, not a skip.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORK = mkdtempSync(join(tmpdir(), "skope-sea-test-"));
const BINARY = join(WORK, "skope-bin");

let blocked: string | undefined;
try {
  execFileSync(process.execPath, [join(ROOT, "scripts/package/sea.mjs"), "--outfile", BINARY], { cwd: ROOT, stdio: "pipe" });
} catch (err) {
  blocked = `sea build failed (single executable applications may be unsupported on this platform): ${
    err instanceof Error ? err.message : String(err)
  }`;
}

afterAll(() => {
  rmSync(WORK, { recursive: true, force: true });
});

// An empty PATH, so the binary can't cheat by shelling back out to a system
// Node (SPEC §5.5, PLAN.md §8: "with node removed from PATH"). Neither test
// below needs any other tool on PATH: --version touches nothing external,
// and the dry-run fake-exec scenario never really executes commands.
function emptyPath(): string {
  return mkdtempSync(join(tmpdir(), "skope-sea-path-"));
}

describe.skipIf(blocked !== undefined)("standalone binary (SPEC §5.5)", () => {
  test("prints the same --version as the npm build", () => {
    // dist/ is built by `npm test`'s pretest step; rebuilding it here would
    // race every other test that runs dist/cli.js.
    const npmOut = execFileSync(process.execPath, [join(ROOT, "dist/cli.js"), "--version"], { encoding: "utf8" });

    const noNode = emptyPath();
    try {
      const out = execFileSync(BINARY, ["--version"], { encoding: "utf8", env: { ...process.env, PATH: noNode } });
      expect(out).toBe(npmOut);
    } finally {
      rmSync(noNode, { recursive: true, force: true });
    }
  });

  test("runs a fake scenario with its expected exit code, with node removed from PATH", () => {
    const skill = join(ROOT, "fixtures/disk-full/SKILL.md");
    const scenario = join(ROOT, "fixtures/disk-full/fakes/dry-run");
    const config = mkdtempSync(join(tmpdir(), "skope-sea-config-"));
    const noNode = emptyPath();
    try {
      const env = {
        PATH: noNode,
        HOME: process.env.HOME,
        XDG_CONFIG_HOME: join(config, "config"),
        XDG_STATE_HOME: join(config, "state"),
        XDG_RUNTIME_DIR: config,
      };
      const args = [skill, "--dry-run", "--fake", join(scenario, "answers.yaml"), "--fake-exec", join(scenario, "commands.yaml")];
      let code = 0;
      try {
        execFileSync(BINARY, args, { encoding: "utf8", env });
      } catch (err) {
        code = (err as { status: number }).status;
      }
      expect(code).toBe(Number(readFileSync(join(scenario, "expected-exit"), "utf8").trim()));
    } finally {
      rmSync(config, { recursive: true, force: true });
      rmSync(noNode, { recursive: true, force: true });
    }
  });
});

test.skipIf(blocked === undefined)(`SKIPPED: ${blocked ?? ""}`, () => {});
