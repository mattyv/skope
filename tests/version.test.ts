// SPEC §7.2: --version prints the release version and build identity,
// matching the identity the build recorded.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("skop --version prints the release version and build identity", () => {
  const identity = JSON.parse(readFileSync(new URL("../dist/build-identity.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const out = execFileSync(process.execPath, [fileURLToPath(new URL("../dist/cli.js", import.meta.url)), "--version"], {
    encoding: "utf8",
  });
  expect(identity.version).toBe(pkg.version);
  expect(identity.build).toMatch(/^[0-9a-f]{64}$/);
  expect(out.trim()).toBe(`skop ${pkg.version} (build identity ${identity.build})`);
});

test("anything but exactly --version is E-USAGE: exit 40, nothing runs", () => {
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  for (const args of [[], ["--verbose"], ["--version", "x"], ["--versionx"]]) {
    let status = 0;
    try {
      execFileSync(process.execPath, [cli, ...args], { stdio: "ignore" });
    } catch (e) {
      status = (e as { status: number }).status;
    }
    expect(status, args.join(" ")).toBe(40);
  }
});
