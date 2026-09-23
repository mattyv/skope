// SPEC §7.2: --version prints the release version and build identity,
// matching the identity the build recorded.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("skop --version prints the release version and build identity", () => {
  const identity = JSON.parse(readFileSync(new URL("../dist/build-identity.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const out = execFileSync(process.execPath, [new URL("../dist/cli.js", import.meta.url).pathname, "--version"], { encoding: "utf8" });
  expect(identity.version).toBe(pkg.version);
  expect(identity.build).toMatch(/^[0-9a-f]{64}$/);
  expect(out.trim()).toBe(`skop ${pkg.version} (build identity ${identity.build})`);
});
