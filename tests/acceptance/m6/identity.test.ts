// M6 (SPEC §7.2, §12.3): "The run_start event, handoff record and verify
// report all carry the same build identity --version prints. One test
// sweeps them all, so a new place that stamps a version can't use a
// different constant." Packaging itself (binaries, installer, npm package,
// container image) is Phase 3's job, not stream F's; this file covers only
// the identity-consistency clause, which is CLI-observable. Expected
// failure until the host stamps skop_version/skop_build for real.

import { describe, expect, test } from "vitest";
import { runSkop } from "../lib/cli.js";

const SKILL = new URL("../../../fixtures/disk-full/SKILL.md", import.meta.url).pathname;
const ANSWERS = new URL("../../../fixtures/disk-full/fakes/page-direct/answers.yaml", import.meta.url).pathname;
const COMMANDS = new URL("../../../fixtures/disk-full/fakes/page-direct/commands.yaml", import.meta.url).pathname;

describe("M6: one build identity everywhere (SPEC §7.2)", () => {
  test.fails("run_start's skop_version/skop_build match `skop --version`", async () => {
    const version = await runSkop(["--version"]);
    const m = version.stdout.match(/^skop (\S+) \(build identity ([0-9a-f]{64})\)/);
    expect(m).not.toBeNull();
    const [, releaseVersion, buildIdentity] = m as unknown as [string, string, string];

    const run = await runSkop([SKILL, "--apply", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    const start = run.events[0] as { event: string; skop_version: string; skop_build: string };
    expect(start.event).toBe("run_start");
    expect(start.skop_version).toBe(releaseVersion);
    expect(start.skop_build).toBe(buildIdentity);
  });
});
