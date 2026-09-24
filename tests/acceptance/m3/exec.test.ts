// M3 (SPEC §12.3): "for each scenario, the event stream matches a golden
// JSONL. Dry run issues no `do` and no page." Every scenario under
// fixtures/*/fakes and fixtures/*/fakes is run for real, through the
// built CLI with --fake and --fake-exec, and its event stream (after the
// golden helper's normalisation) must equal the hand-written golden in
// tests/acceptance/m3/golden/.

import { describe, expect, test } from "vitest";
import { normalise } from "../../helpers/golden.js";
import { runSkope } from "../lib/cli.js";
import { allScenarios, readExpectedExit, readGolden } from "../lib/scenarios.js";

describe("M3: exec with fakes matches the golden event stream (SPEC §12.3)", () => {
  for (const s of allScenarios()) {
    // dry-run scenarios are the SPEC §4.5 half of M3 ("dry run issues no `do` and no page");
    // everything else is the general "matches a golden JSONL" clause.
    const isDryRun = s.name === "dry-run";
    const title = isDryRun
      ? `${s.fixture}/${s.name}: dry run issues no do (would_do only) and no page (would_page only)`
      : `${s.fixture}/${s.name}: event stream matches the golden`;

    test(title, async () => {
      const mode = isDryRun ? "--dry-run" : "--apply";
      const result = await runSkope([s.skillPath, mode, "--fake", s.answersPath, "--fake-exec", s.commandsPath]);
      const expected = readGolden(s.goldenPath);
      expect(normalise(result.events)).toEqual(normalise(expected));
      expect(result.code).toBe(readExpectedExit(s.expectedExitPath));
      if (isDryRun) {
        // "do" isn't a real event kind (SPEC §10 has no such event); dry run suppresses a
        // `do` as `would_do` instead, so no `effect_start`/`effect_end` pair is ever logged,
        // and suppresses a `page` as `would_page`/`would_page`'s handoff sibling instead, so
        // no `page` or `handoff_page` is ever logged (SPEC §4.5, §8).
        expect(result.events.some((e: { event: string }) => e.event === "effect_start" || e.event === "effect_end")).toBe(false);
        expect(result.events.some((e: { event: string }) => e.event === "page" || e.event === "handoff_page")).toBe(false);
      }
    });
  }
});
