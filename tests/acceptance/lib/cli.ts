// Spawns the built CLI (PLAN.md §4 F: "end-to-end CLI tests ... spawn `node
// dist/cli.js` with args"). Every acceptance test that needs a live process
// goes through this, so there's one place that knows how skop is invoked.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../../dist/cli.js", import.meta.url));

/** A parsed line of skop's JSON Lines output (SPEC §10); shape varies by `event`. */
export type SkopEvent = { event: string } & Record<string, unknown>;

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  events: SkopEvent[];
}

// P1: each call gets its own throwaway XDG dirs, so parallel test runs never collide on the
// lock at $XDG_RUNTIME_DIR/skop/<name>.lock (SPEC §7 step 3), and never leak state between
// runs. Unless the test passes its own `--config` (e.g. the pager-failure test, which needs
// `pager.command: exit 1`), a config is written with a harmless pager (SPEC §5.4: the pager
// isn't a skill command, so it always really runs) and a fixed state_dir, so `page`/
// `handoff_page` events come back `ok: true` and run directories land somewhere disposable.
function cleanEnv(args: string[], extra: Record<string, string> | undefined): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), "skop-test-"));
  const configHome = join(root, "config");
  const stateHome = join(root, "state");
  const runtimeDir = join(root, "runtime");

  const env: Record<string, string> = {
    ...process.env,
    XDG_CONFIG_HOME: configHome,
    XDG_STATE_HOME: stateHome,
    XDG_RUNTIME_DIR: runtimeDir,
  };
  delete env.SKOP_CALLER;
  // XDG_RUNTIME_DIR, when set, is a directory that exists (XDG Base Directory spec); skop doesn't create it.
  mkdirSync(runtimeDir, { mode: 0o700 });

  if (!args.includes("--config")) {
    mkdirSync(join(configHome, "skop"), { recursive: true });
    writeFileSync(
      join(configHome, "skop", "config.yaml"),
      `pager:\n  command: "cat > /dev/null"\nstate_dir: ${stateHome}/skop\nask:\n  backend: fake\n`,
    );
  }

  return { ...env, ...extra };
}

export function runSkop(args: string[], opts: { env?: Record<string, string>; input?: string } = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: cleanEnv(args, opts.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      const events: SkopEvent[] = stdout
        .split("\n")
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as SkopEvent];
          } catch {
            return []; // stdout isn't JSON Lines yet (pre-M2): ignore for event-shaped assertions
          }
        });
      resolve({ code, stdout, stderr, events });
    });
    if (opts.input !== undefined) child.stdin.write(opts.input);
    child.stdin.end();
  });
}
