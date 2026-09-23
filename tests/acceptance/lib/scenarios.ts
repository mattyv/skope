// Shared helpers for the acceptance suite (PLAN.md §4 F). Enumerates the
// fake scenario directories under fixtures/*/fakes and
// fixtures-next/*/fakes (SPEC §12.1), each holding answers.yaml,
// commands.yaml and expected-exit.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export interface Scenario {
  /** e.g. "disk-full" */
  fixture: string;
  /** e.g. "fixtures/disk-full" or "fixtures-next/error-triage" */
  fixtureDir: string;
  /** e.g. "clean-up-happy" */
  name: string;
  dir: string;
  skillPath: string;
  answersPath: string;
  commandsPath: string;
  expectedExitPath: string;
  goldenPath: string;
}

function listFixtureScenarios(fixtureDir: string): Scenario[] {
  const fixture = fixtureDir.split("/").pop() as string;
  const fakesDir = `${ROOT}/${fixtureDir}/fakes`;
  let names: string[];
  try {
    names = readdirSync(fakesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
  return names.map((name) => {
    const dir = `${fakesDir}/${name}`;
    return {
      fixture,
      fixtureDir,
      name,
      dir,
      skillPath: `${ROOT}/${fixtureDir}/SKILL.md`,
      answersPath: `${dir}/answers.yaml`,
      commandsPath: `${dir}/commands.yaml`,
      expectedExitPath: `${dir}/expected-exit`,
      goldenPath: `${ROOT}/tests/acceptance/m3/golden/${fixture}/${name}.jsonl`,
    };
  });
}

export function allScenarios(): Scenario[] {
  return [
    ...listFixtureScenarios("fixtures/disk-full"),
    ...listFixtureScenarios("fixtures/cert-expiry"),
    ...listFixtureScenarios("fixtures-next/error-triage"),
  ];
}

// fixtures/*/fakes/**/*.yaml here are written as JSON, which is valid YAML,
// so no YAML dependency is needed to read them back for validation.
export function readYaml(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readExpectedExit(path: string): number {
  const text = readFileSync(path, "utf8").trim();
  const n = Number(text);
  if (!Number.isInteger(n)) throw new Error(`${path}: expected-exit isn't an integer: ${JSON.stringify(text)}`);
  return n;
}

/** A parsed line of a golden event stream; shape varies by `event` (SPEC §10). */
export type GoldenEvent = { event: string } & Record<string, unknown>;

export function readGolden(path: string): GoldenEvent[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GoldenEvent);
}
