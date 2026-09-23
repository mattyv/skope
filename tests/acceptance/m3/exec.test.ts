// M3 (SPEC §12.3): "for each scenario, the event stream matches a golden
// JSONL. Dry run issues no `do` and no page." Every scenario under
// fixtures/*/fakes and fixtures-next/*/fakes is run for real, through the
// built CLI with --fake and --fake-exec, and its event stream (after the
// golden helper's normalisation) must equal the hand-written golden in
// tests/acceptance/m3/golden/.
//
// Expected failure until the host loop, CLI and core interpreter exist
// (PLAN.md §4 G); the CLI today only supports --version and exits 50 for
// everything else, so these fail on "wrong exit code", not a crash. Stream
// G flips each `test.fails` to `test` as its scenario starts passing —
// this file doesn't need to change shape when that happens, only the
// `.fails` modifier per scenario.

import { describe, expect, test } from "vitest";
import { normalise } from "../../helpers/golden.js";
import { runSkop } from "../lib/cli.js";
import { allScenarios, readGolden } from "../lib/scenarios.js";

describe("M3: exec with fakes matches the golden event stream (SPEC §12.3)", () => {
  for (const s of allScenarios()) {
    // dry-run scenarios are the SPEC §4.5 half of M3 ("dry run issues no `do` and no page");
    // everything else is the general "matches a golden JSONL" clause.
    const isDryRun = s.name === "dry-run";
    const title = isDryRun
      ? `${s.fixture}/${s.name}: dry run issues no do (would_do only) and no page (would_page only)`
      : `${s.fixture}/${s.name}: event stream matches the golden`;

    test.fails(title, async () => {
      const mode = isDryRun ? "--dry-run" : "--apply";
      const result = await runSkop([s.skillPath, mode, "--fake", s.answersPath, "--fake-exec", s.commandsPath]);
      const expected = readGolden(s.goldenPath);
      expect(normalise(result.events)).toEqual(normalise(expected));
      if (isDryRun) {
        expect(result.events.some((e: { event: string }) => e.event === "do")).toBe(false);
        expect(result.events.some((e: { event: string }) => e.event === "page")).toBe(false);
      }
    });
  }
});
