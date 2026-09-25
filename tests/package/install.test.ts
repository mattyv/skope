// M6 packaging (SPEC §5.5, §12.3): install.sh, tested against a local HTTP
// server standing in for a GitHub release, via SKOPE_DOWNLOAD_URL. The
// "binary" is a tiny shell script that prints a fixed version line for
// --version — install.sh doesn't care what the binary is, only that its
// checksum matches and that it runs.
//
// shellcheck itself is a separate check (see the "shellcheck" test below
// and the packaging job in ci.yml); it's skipped here with a clear reason
// if the binary isn't on this machine.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const INSTALL_SH = join(ROOT, "install.sh");
const VERSION = "9.9.9";
// The release file install.sh will look for on this machine (its os/arch tables).
const HOST = `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch}`;
const BINARY_NAME = `skope-${VERSION}-${HOST}`;
const FAKE_BINARY = `#!/bin/sh\necho "skope ${VERSION} (build identity ${"a".repeat(64)})"\n`;

let server: Server | undefined;
let releaseDir: string;
let workDir: string;

afterEach(() => {
  server?.close();
  server = undefined;
  if (releaseDir) rmSync(releaseDir, { recursive: true, force: true });
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

/** A directory holding a fake release's files, served two ways so both the default (latest) and $SKOPE_VERSION paths can be tested: `/latest/download/<file>` and `/download/v<version>/<file>`, mirroring GitHub's own layout under $SKOPE_DOWNLOAD_URL. */
function makeRelease(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), "skope-release-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function serve(dir: string): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      const url = req.url ?? "/";
      const name = url.startsWith("/latest/download/") ? url.slice("/latest/download/".length) : url.replace(/^\/download\/v[^/]+\//, "");
      const path = join(dir, name);
      if (!existsSync(path)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200).end(readFileSync(path));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server?.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function sumsFile(name: string, content: string | Buffer): string {
  return `${sha256(content)}  ${name}\n`;
}

// Async, not spawnSync: install.sh downloads from a server running in this
// same process, and spawnSync would block the event loop that server needs
// to answer the request — a deadlock, not a slow test.
function run(env: Record<string, string | undefined>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("sh", [INSTALL_SH], { env: { PATH: process.env.PATH ?? "", ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

describe("install.sh (SPEC §5.5, §12.3)", () => {
  test("installs the binary for the machine's platform into SKOPE_INSTALL_DIR", async () => {
    releaseDir = makeRelease({ [BINARY_NAME]: FAKE_BINARY, SHA256SUMS: sumsFile(BINARY_NAME, FAKE_BINARY) });
    chmodSync(join(releaseDir, BINARY_NAME), 0o755);
    const url = await serve(releaseDir);
    workDir = mkdtempSync(join(tmpdir(), "skope-install-"));
    const installDir = join(workDir, "bin");

    const result = await run({ SKOPE_DOWNLOAD_URL: url, SKOPE_VERSION: VERSION, SKOPE_INSTALL_DIR: installDir, HOME: workDir });

    // Progress and the PATH hint go to stderr (say()); only the final
    // `skope --version` (the installed "binary" itself) writes to stdout.
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`skope ${VERSION} (build identity ${"a".repeat(64)})\n`);
    expect(existsSync(join(installDir, "skope"))).toBe(true);
  });

  test("installs the agent skills when Claude Code is set up, unless SKOPE_NO_SKILL is set", async () => {
    // A binary that records its arguments, so the test sees what install.sh asked of it.
    const binary = '#!/bin/sh\necho "$@" >> "$HOME/calls"\necho "skope 9.9.9"\n';
    releaseDir = makeRelease({ [BINARY_NAME]: binary, SHA256SUMS: sumsFile(BINARY_NAME, binary) });
    const url = await serve(releaseDir);
    workDir = mkdtempSync(join(tmpdir(), "skope-install-"));
    const env = { SKOPE_DOWNLOAD_URL: url, SKOPE_VERSION: VERSION, SKOPE_INSTALL_DIR: join(workDir, "bin"), HOME: workDir };
    const calls = () => readFileSync(join(workDir, "calls"), "utf8");

    // No ~/.claude: nothing to install into, so it only says how.
    let result = await run(env);
    expect(result.status).toBe(0);
    expect(calls()).toBe("--version\n");
    expect(result.stderr).toContain("skope --install-skill");

    mkdirSync(join(workDir, ".claude"));
    rmSync(join(workDir, "calls"));
    result = await run(env);
    expect(result.status).toBe(0);
    // Its output goes to stderr: stdout stays the one --version line.
    expect(result.stdout).toBe("skope 9.9.9\n");
    expect(calls()).toBe(`--install-skill ${join(workDir, ".claude", "skills")}\n--version\n`);

    rmSync(join(workDir, "calls"));
    result = await run({ ...env, SKOPE_NO_SKILL: "1" });
    expect(calls()).toBe("--version\n");
  });

  test("a binary whose sha256 doesn't match SHA256SUMS fails the install and installs nothing", async () => {
    const tampered = `${FAKE_BINARY}# tampered\n`;
    releaseDir = makeRelease({ [BINARY_NAME]: tampered, SHA256SUMS: sumsFile(BINARY_NAME, FAKE_BINARY) });
    chmodSync(join(releaseDir, BINARY_NAME), 0o755);
    const url = await serve(releaseDir);
    workDir = mkdtempSync(join(tmpdir(), "skope-install-"));
    const installDir = join(workDir, "bin");

    const result = await run({ SKOPE_DOWNLOAD_URL: url, SKOPE_VERSION: VERSION, SKOPE_INSTALL_DIR: installDir, HOME: workDir });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/checksum mismatch/);
    expect(existsSync(installDir)).toBe(false);
  });

  test("a missing SHA256SUMS fails the install and installs nothing", async () => {
    releaseDir = makeRelease({ [BINARY_NAME]: FAKE_BINARY });
    chmodSync(join(releaseDir, BINARY_NAME), 0o755);
    const url = await serve(releaseDir);
    workDir = mkdtempSync(join(tmpdir(), "skope-install-"));
    const installDir = join(workDir, "bin");

    const result = await run({ SKOPE_DOWNLOAD_URL: url, SKOPE_VERSION: VERSION, SKOPE_INSTALL_DIR: installDir, HOME: workDir });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/SHA256SUMS/);
    expect(existsSync(installDir)).toBe(false);
  });

  test("SKOPE_VERSION picks the version, served under /download/v<version>/", async () => {
    releaseDir = makeRelease({ [BINARY_NAME]: FAKE_BINARY, SHA256SUMS: sumsFile(BINARY_NAME, FAKE_BINARY) });
    chmodSync(join(releaseDir, BINARY_NAME), 0o755);
    const url = await serve(releaseDir);
    workDir = mkdtempSync(join(tmpdir(), "skope-install-"));
    const installDir = join(workDir, "bin");

    // No "latest" route exists on this server (only /download/v<version>/),
    // so this only succeeds if SKOPE_VERSION was actually used to pick the URL.
    const result = await run({ SKOPE_DOWNLOAD_URL: url, SKOPE_VERSION: VERSION, SKOPE_INSTALL_DIR: installDir, HOME: workDir });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(VERSION);
  });

  test("defaults to /latest/download/ when SKOPE_VERSION isn't set", async () => {
    releaseDir = makeRelease({ [BINARY_NAME]: FAKE_BINARY, SHA256SUMS: sumsFile(BINARY_NAME, FAKE_BINARY) });
    chmodSync(join(releaseDir, BINARY_NAME), 0o755);
    const url = await serve(releaseDir);
    workDir = mkdtempSync(join(tmpdir(), "skope-install-"));
    const installDir = join(workDir, "bin");

    const result = await run({ SKOPE_DOWNLOAD_URL: url, SKOPE_INSTALL_DIR: installDir, HOME: workDir });

    expect(result.status).toBe(0);
    expect(existsSync(join(installDir, "skope"))).toBe(true);
  });

  test("an unknown platform exits non-zero and names it", async () => {
    workDir = mkdtempSync(join(tmpdir(), "skope-install-"));
    const fakeUnameDir = join(workDir, "fake-bin");
    mkdirSync(fakeUnameDir, { recursive: true });
    // Ignores its argument so both `uname -s` and `uname -m` return
    // something no case in install.sh's os/arch tables matches.
    writeFileSync(join(fakeUnameDir, "uname"), "#!/bin/sh\necho SunOS\n");
    chmodSync(join(fakeUnameDir, "uname"), 0o755);

    const installDir = join(workDir, "bin");
    const result = await run({
      PATH: `${fakeUnameDir}:${process.env.PATH ?? ""}`,
      SKOPE_DOWNLOAD_URL: "http://127.0.0.1:1", // never reached: platform detection fails first
      SKOPE_INSTALL_DIR: installDir,
      HOME: workDir,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/SunOS/);
    expect(existsSync(installDir)).toBe(false);
  });
});

describe("shellcheck", () => {
  test("install.sh passes shellcheck -s sh", () => {
    let hasShellcheck = true;
    try {
      execFileSync("shellcheck", ["--version"], { stdio: "ignore" });
    } catch {
      hasShellcheck = false;
    }
    if (!hasShellcheck) {
      console.warn("shellcheck isn't installed on this machine; skipping (ci.yml runs it in CI, see PLAN.md §8).");
      return;
    }
    expect(() => execFileSync("shellcheck", ["-s", "sh", INSTALL_SH], { stdio: "pipe" })).not.toThrow();
  });
});
