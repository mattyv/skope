// The release workflow only runs on a tag, so its permissions are checked
// here: a job that attests needs to sign (id-token) and store (attestations),
// and a missing permission only shows up when a release is cut.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { describe, expect, test } from "vitest";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows");

interface Job {
  permissions?: Record<string, string>;
  steps?: { uses?: string }[];
}

describe("workflow permissions", () => {
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".yml"))) {
    const wf = load(readFileSync(join(DIR, file), "utf8")) as { permissions?: Record<string, string>; jobs: Record<string, Job> };
    for (const [name, job] of Object.entries(wf.jobs)) {
      if (!job.steps?.some((s) => s.uses?.startsWith("actions/attest-build-provenance"))) continue;
      test(`${file}: ${name} can attest`, () => {
        const perms = job.permissions ?? wf.permissions ?? {};
        expect(perms["id-token"]).toBe("write");
        expect(perms.attestations).toBe("write");
      });
    }
  }
});
