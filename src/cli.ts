#!/usr/bin/env node
// skop's command line (SPEC §7). Phase 0: only --version works.

import { readFileSync } from "node:fs";

// Written by scripts/build-id.mjs at build time (SPEC §7.2). No fallback:
// a build without it isn't a build.
const identity = JSON.parse(readFileSync(new URL("./build-identity.json", import.meta.url), "utf8")) as {
  version: string;
  build: string;
};

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log(`skop ${identity.version} (build identity ${identity.build})`);
  process.exit(0);
}
console.error("skop: only --version works so far (Phase 0).");
process.exit(50);
