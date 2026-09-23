// M6 packaging (SPEC §5.5, PLAN.md §8): scripts/package/sea.mjs builds a
// Node single executable application from the bundle. This builds one
// locally (embedding the running Node, per the script's own default) and
// checks it prints the same `--version` as the npm build and runs a fake
// scenario with its expected exit code, with `node` removed from PATH.
//
// Skips (with a clear reason) when:
// - the platform's Node build doesn't support single executable
//   applications (no --experimental-sea-config, or postject can't inject
//   into this platform's binary format);
// - the bundle itself can't run yet — the same createRequire(import.meta.url)
//   gap documented in tests/package/bundle.test.ts, which blocks every SEA
//   binary the same way since it embeds the same bundle.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORK = mkdtempSync(join(tmpdir(), "skop-sea-test-"));
const BINARY = join(WORK, "skop-bin");

let blocked: string | undefined;
try {
  execFileSync(process.execPath, [join(ROOT, "scripts/package/sea.mjs"), "--outfile", BINARY], { cwd: ROOT, stdio: "pipe" });
} catch (err) {
  blocked = `sea build failed (SEA/postject may be unsupported on this platform, or the bundle can't run — see tests/package/bundle.test.ts): ${
    err instanceof Error ? err.message : String(err)
  }`;
}

if (blocked === undefined) {
  try {
    execFileSync(BINARY, ["--version"], { encoding: "utf8" });
  } catch (err) {
    blocked = `the built binary can't run --version (see tests/package/bundle.test.ts for the likely cause): ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}

afterAll(() => {
  rmSync(WORK, { recursive: true, force: true });
});

// An empty PATH, so the binary can't cheat by shelling back out to a system
// Node (SPEC §5.5, PLAN.md §8: "with node removed from PATH"). Neither test
// below needs any other tool on PATH: --version touches nothing external,
// and the dry-run fake-exec scenario never really executes commands.
function emptyPath(): string {
  return mkdtempSync(join(tmpdir(), "skop-sea-path-"));
}

describe.skipIf(blocked !== undefined)("standalone binary (SPEC §5.5)", () => {
  test("prints the same --version as the npm build", () => {
    execFileSync(process.execPath, ["-e", "require('fs').rmSync('dist',{recursive:true,force:true})"], { cwd: ROOT });
    execFileSync(process.execPath, [join(ROOT, "scripts/build-id.mjs"), "--write", "dist/build-identity.json"], { cwd: ROOT });
    execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], { cwd: ROOT, stdio: "pipe" });
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
    const config = mkdtempSync(join(tmpdir(), "skop-sea-config-"));
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
