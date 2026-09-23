// skop's release version and build identity (SPEC §7.2), from the one file
// the build writes. Everything that stamps a version reads it here: no
// fallback, a build without it isn't a build.

import { readFileSync } from "node:fs";

let cached: { version: string; build: string } | undefined;

export function identity(): { version: string; build: string } {
  cached ??= JSON.parse(readFileSync(new URL("../build-identity.json", import.meta.url), "utf8"));
  return cached as { version: string; build: string };
}
