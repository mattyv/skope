// `skope --test --live` (docs/design/skill-tests.md, SPEC §7.3): every ask
// goes to the configured backend and each scenario runs several times. The
// backend here is the real Jev client over a stubbed fetch, so no request
// leaves the machine; each test scripts the answers it wants per run.

import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runSkope } from "../acceptance/lib/cli.js";
import { ROOT } from "../acceptance/lib/scenarios.js";

// From the build, like the CLI tests: the build identity only exists there. Typed from the source.
const DIST = "../../dist/host/test.js";
const { runTests } = (await import(DIST)) as typeof import("../../src/host/test.js");

const KEY_ENV = "SKOPE_LIVE_TEST_KEY";
const COMMANDS = {
  "Triage.used": { exit: 0, stdout: " 93%\n" },
  "Triage.errors": { exit: 0, stdout: "myapp-worker OOM\n" },
  "Triage.biggest": { exit: 0, stdout: "40G\t/var\n" },
  "systemctl restart myapp-worker": { exit: 0 },
  "Restart.used": { exit: 0, stdout: " 91%\n" },
};
const EXPECT = {
  outcome: "paged",
  asks: { Triage: { chosen: "Restart" }, "Restart.service": { chosen: "myapp-worker" } },
};

/** A disk-full copy with one scenario, and a config that asks Jev with no retries. */
function setup(expectDoc: unknown, answers?: unknown): { skill: string; config: string } {
  const dir = mkdtempSync(join(tmpdir(), "skope-live-"));
  copyFileSync(`${ROOT}/fixtures/disk-full/SKILL.md`, join(dir, "SKILL.md"));
  const s = join(dir, "tests", "restart");
  mkdirSync(s, { recursive: true });
  writeFileSync(join(s, "commands.yaml"), JSON.stringify(COMMANDS));
  writeFileSync(join(s, "expect.yaml"), JSON.stringify(expectDoc));
  if (answers !== undefined) writeFileSync(join(s, "answers.yaml"), JSON.stringify(answers));
  const config = join(dir, "config.yaml");
  writeFileSync(config, `ask:\n  backend: jev\n  retries: 0\njev:\n  model: jev-1.13.0\n  key_env: ${KEY_ENV}\n`, { mode: 0o600 });
  return { skill: join(dir, "SKILL.md"), config };
}

type Probs = Record<string, number>;
/** Answers by run: `triage[i]` and `service[i]` answer run i+1 (the last repeats). */
function backend(
  triage: Probs[],
  service: Probs[] = [{ nginx: 0.03125, rsyslog: 0.03125, "myapp-worker": 0.90625, "myapp-api": 0.03125 }],
) {
  const seen = { triage: 0, service: 0, calls: 0 };
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    seen.calls++;
    const q = JSON.parse(init.body).questions.q;
    const labels = Object.keys(q.criteria ?? {});
    const list = labels.includes("Restart") ? triage : service;
    const n = labels.includes("Restart") ? seen.triage++ : seen.service++;
    const probabilities = list[Math.min(n, list.length - 1)];
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers: { q: { type: "choice", probabilities } } }), { status: 200 });
  });
  return seen;
}
const RESTART: Probs = { "Clean up": 0.03125, Restart: 0.875, Page: 0.0625, Investigate: 0.03125 };
const PAGE: Probs = { "Clean up": 0.03125, Restart: 0.0625, Page: 0.875, Investigate: 0.03125 };

async function live(paths: { skill: string; config: string }, runs?: number) {
  const out: string[] = [];
  const err: string[] = [];
  const o = vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
  const e = vi.spyOn(process.stderr, "write").mockImplementation((s) => (err.push(String(s)), true));
  let code: number;
  try {
    code = await runTests({ file: paths.skill, params: [], config: paths.config, live: true, runs });
  } finally {
    o.mockRestore();
    e.mockRestore();
  }
  const lines = out
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return { code, scenario: lines[0], summary: lines.at(-1), stderr: err.join("") };
}

beforeEach(() => {
  process.env[KEY_ENV] = "k-live-test-0123456789";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env[KEY_ENV];
});

describe("skope --test --live", () => {
  test("every run a hit: pass, with hit rate, per-ask confidence and margin, and near-gate warnings", async () => {
    const seen = backend([RESTART]);
    const r = await live(setup({ ...EXPECT, live: { runs: 3 } }));
    expect(r.code).toBe(0);
    expect(r.scenario).toMatchObject({ scenario: "restart", pass: true, runs: 3, hits: 3, hit_rate: 1 });
    expect(r.scenario.asks).toEqual([
      {
        ask: "Triage",
        line: 27,
        reached: 3,
        chosen: { Restart: 3 },
        confidence_min: 0.875,
        confidence_median: 0.875,
        sure: 85,
        margin: 3,
        gate_failures: 0,
      },
      expect.objectContaining({ ask: "Restart.service", chosen: { "myapp-worker": 3 }, sure: 90, margin: 1 }),
    ]);
    // No min_margin: a margin under 5 points warns but doesn't fail.
    expect(r.scenario.warnings).toEqual(["Triage: margin +3 is near the gate", "Restart.service: margin +1 is near the gate"]);
    expect(r.stderr).toContain("Triage  Restart 3/3  conf min 88% med 88%  sure 85  margin +3  WARN near gate");
    expect(seen.calls).toBe(6);
  });

  test("the call count before the runs is a maximum, from the explorer, and names the backend", async () => {
    backend([RESTART]);
    const r = await live(setup({ ...EXPECT, live: { runs: 2 } }));
    expect(r.summary).toMatchObject({ live: true, backend: "jev", model: "jev-1.13.0" });
    expect(r.summary.max_backend_calls).toBeGreaterThanOrEqual(4); // at least the 2 asks this path takes, twice
    expect(r.summary.max_backend_calls % 2).toBe(0);
    expect(r.stderr).toContain(`at most ${r.summary.max_backend_calls} backend calls to jev (jev-1.13.0)`);
  });

  test("an explicit min_margin fails a scenario whose lowest confidence doesn't clear sure by that much", async () => {
    backend([RESTART]);
    const r = await live(setup({ ...EXPECT, live: { runs: 2, min_margin: 5 } }));
    expect(r.code).toBe(60);
    expect(r.scenario.mismatch).toBe("Triage: margin +3 is under min_margin 5");
  });

  test("a miss is a run that doesn't satisfy the whole expect.yaml; min_hit_rate decides", async () => {
    backend([RESTART, PAGE, RESTART]);
    const lenient = await live(setup({ ...EXPECT, live: { runs: 3, min_hit_rate: 0.6 } }));
    expect(lenient.code).toBe(0);
    expect(lenient.scenario).toMatchObject({ hits: 2, runs: 3 });
    expect(lenient.scenario.asks[0].chosen).toEqual({ Restart: 2, Page: 1 });

    backend([RESTART, PAGE, RESTART]);
    const strict = await live(setup({ ...EXPECT, live: { runs: 3 } }));
    expect(strict.code).toBe(60);
    expect(strict.scenario.mismatch).toMatch(/^hit rate 2\/3 is under 1; first miss: run 2: /);
  });

  test("an expected ask a run never reaches is a miss", async () => {
    backend([PAGE]);
    const r = await live(setup({ outcome: "paged", asks: { "Restart.service": { chosen: "myapp-worker" } }, live: { runs: 1 } }));
    expect(r.code).toBe(60);
    expect(r.scenario.mismatch).toContain("never reached that ask");
  });

  test("--runs overrides live.runs", async () => {
    const seen = backend([RESTART]);
    const r = await live(setup({ ...EXPECT, live: { runs: 5 } }), 1);
    expect(r.scenario.runs).toBe(1);
    expect(seen.calls).toBe(2);
  });

  test("answers.yaml is ignored: every ask goes to the backend", async () => {
    const seen = backend([RESTART]);
    const r = await live(setup({ ...EXPECT, live: { runs: 1 } }, { "Triage.ask": "unavailable" }));
    expect(r.code).toBe(0);
    expect(seen.calls).toBe(2);
  });

  test("a backend that fails makes misses, not a crash", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    const r = await live(setup({ ...EXPECT, live: { runs: 2 } }));
    expect(r.code).toBe(60);
    expect(r.scenario).toMatchObject({ hits: 0, runs: 2 });
    expect(r.scenario.asks[0].chosen).toEqual({ "(unavailable)": 2 });
  });

  test("no API key is E-CONFIG: the scenario is invalid, exit 40", async () => {
    backend([RESTART]);
    delete process.env[KEY_ENV];
    const r = await live(setup({ ...EXPECT, live: { runs: 2 } }));
    expect(r.code).toBe(40);
    expect(r.scenario.invalid).toContain("E-CONFIG");
  });
});

describe("--live and --runs on the command line", () => {
  test.each([
    [["--live"], "--live goes with --test"],
    [["--test", "--runs", "3"], "--runs goes with --live"],
    [["--test", "--live", "--runs", "0"], "--runs must be a whole number from 1"],
    [["--test", "--live", "--runs", "two"], "--runs must be a whole number from 1"],
  ])("%j is E-USAGE", async (args, why) => {
    const r = await runSkope([`${ROOT}/fixtures/disk-full/SKILL.md`, ...args]);
    expect(r.code).toBe(40);
    expect(r.stderr).toContain(why);
  });
});
