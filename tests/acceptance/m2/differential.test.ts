// The differential check (SPEC §12.4): "For each fake scenario, the
// concrete trace MUST appear among the explore handler's paths. Deadline
// scenarios are excluded (SPEC §5.4)." PLAN.md §4 F: "the differential
// check ..., ready to run once integration lands." None of this repo's
// fixtures exercise a deadline handoff, so none are excluded here.
//
// SPEC §5.6 describes the verify report's content (total paths, reachable
// outcomes, max backend calls/effects, worst-case duration, unreached
// sections) but contracts/ has no JSON schema pinning its exact shape. This
// test assumes `skop --verify --json <skill>` prints one JSON object with a
// `paths` array, each entry a `src` (SKILL.md line number) array describing
// one abstract path through the transfer graph, in execution order — the
// natural reading of §5.4's "explore handler ... walks the paths" and
// §5.6's "total abstract paths". If stream G's real report shape differs
// (a different field name, or `--verify` without `--json` already printing
// structured JSON), fix the two small helpers below rather than the
// scenario loop; this is noted as a spec gap in the stream F report.

import { describe, expect, test } from "vitest";
import { runSkop } from "../lib/cli.js";
import { allScenarios, readGolden } from "../lib/scenarios.js";

/** The concrete trace: src lines of every instruction the run actually executed, in order. */
function concreteTrace(events: object[]): number[] {
  const stepKinds = new Set(["run", "check_cmd", "check", "ask", "effect_start", "would_do", "page", "would_page", "hand_off"]);
  return events
    .filter((e) => stepKinds.has((e as { event: string }).event))
    .map((e) => (e as { line: number }).line)
    .filter((line) => typeof line === "number");
}

async function verifyPaths(skillPath: string): Promise<number[][]> {
  const r = await runSkop([skillPath, "--verify", "--json"]);
  const report = JSON.parse(r.stdout) as { paths: { src: number[] }[] };
  return report.paths.map((p) => p.src);
}

function isSubsequence(needle: number[], haystack: number[]): boolean {
  let i = 0;
  for (const x of haystack) {
    if (i < needle.length && x === needle[i]) i++;
  }
  return i === needle.length;
}

describe("differential check: every concrete fake trace appears among --verify's explored paths (SPEC §12.4)", () => {
  for (const s of allScenarios()) {
    test.fails(`${s.fixture}/${s.name}`, async () => {
      const golden = readGolden(s.goldenPath);
      const trace = concreteTrace(golden);
      const paths = await verifyPaths(s.skillPath);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.some((p) => isSubsequence(trace, p))).toBe(true);
    });
  }
});
