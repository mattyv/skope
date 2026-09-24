#!/usr/bin/env node
// Builds skope's standalone binary as a Node single executable application
// (SPEC §5.5): the CommonJS bundle (scripts/package/bundle.mjs), embedded
// into a copy of the Node binary with `--experimental-sea-config` and
// `postject`. Ad-hoc signed on macOS (`codesign --sign -`) so it runs.
//
// Usage: node scripts/package/sea.mjs [--node path] [--bundle path] [--outfile path]
//   --node     Node executable to embed the blob into. Defaults to the
//              running Node (process.execPath), which is what a local
//              build uses; CI passes a pinned Node build (PLAN.md §8).
//   --bundle   Pre-built CommonJS bundle to embed, used as given. Without
//              it, a fresh bundle is always built from the current source,
//              so a stale one can't ship under a newer build identity.
//   --outfile  Where to write the binary. Defaults to
//              dist-bin/skope-<platform>-<arch>; the release workflow
//              renames the result to skope-<version>-<os>-<arch>.

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const nodeBin = arg("--node", process.execPath);
const bundlePath = arg("--bundle", join(ROOT, "dist-bundle", "skope.cjs"));
if (process.argv.includes("--bundle") && !existsSync(bundlePath)) throw new Error(`sea: no bundle at ${bundlePath}`);
const outFile = arg(
  "--outfile",
  join(ROOT, "dist-bin", `skope-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`),
);

if (!process.argv.includes("--bundle")) {
  execFileSync(process.execPath, [join(ROOT, "scripts", "package", "bundle.mjs"), "--outfile", bundlePath], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

const postjectCli = join(ROOT, "node_modules", "postject", "dist", "cli.js");
if (!existsSync(postjectCli)) {
  throw new Error(`sea: postject not found at ${postjectCli}; is it installed as a devDependency?`);
}

const work = mkdtempSync(join(tmpdir(), "skope-sea-"));
try {
  const configPath = join(work, "sea-config.json");
  const blobPath = join(work, "skope.blob");
  writeFileSync(
    configPath,
    JSON.stringify({
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    }),
  );
  execFileSync(nodeBin, ["--experimental-sea-config", configPath], { cwd: work, stdio: "inherit" });

  mkdirSync(dirname(outFile), { recursive: true });
  copyFileSync(nodeBin, outFile);
  chmodSync(outFile, 0o755);

  if (process.platform === "darwin") {
    try {
      execFileSync("codesign", ["--remove-signature", outFile], { stdio: "inherit" });
    } catch {
      // No existing signature to remove is fine.
    }
  } else if (process.platform === "win32") {
    try {
      execFileSync("signtool", ["remove", "/s", outFile], { stdio: "inherit" });
    } catch {
      // No existing signature to remove is fine.
    }
  }

  const postjectArgs = [outFile, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"];
  if (process.platform === "darwin") postjectArgs.push("--macho-segment-name", "NODE_SEA");
  execFileSync(process.execPath, [postjectCli, ...postjectArgs], { stdio: "inherit" });

  if (process.platform === "darwin") {
    execFileSync("codesign", ["--sign", "-", outFile], { stdio: "inherit" });
  }

  console.log(`sea: wrote ${outFile}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
