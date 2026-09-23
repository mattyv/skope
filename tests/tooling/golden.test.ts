// Tests for tests/helpers/golden.ts itself: which fields it drops, that
// event order is significant, and expectGolden's pass/fail/write behaviour.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { expectGolden, normalise, toJsonl } from "../helpers/golden.js";

const dirsMade: string[] = [];
afterEach(() => {
  for (const d of dirsMade.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmpGoldenUrl(): URL {
  const dir = mkdtempSync(join(tmpdir(), "golden-"));
  dirsMade.push(dir);
  return pathToFileURL(join(dir, "case.jsonl"));
}

describe("golden helper: field dropping", () => {
  test("run_dir is dropped", () => {
    expect(normalise([{ event: "x", run_dir: "/tmp/whatever" }])).toEqual([{ event: "x" }]);
  });

  test("path is dropped", () => {
    expect(normalise([{ event: "x", path: "/some/path" }])).toEqual([{ event: "x" }]);
  });

  test("line is kept (it's part of the event, not a run artifact)", () => {
    expect(normalise([{ event: "error", line: 14 }])).toEqual([{ event: "error", line: 14 }]);
  });
});

describe("golden helper: event order", () => {
  test("swapping two events changes the golden", () => {
    const a = { event: "a" };
    const b = { event: "b" };
    expect(toJsonl([a, b])).not.toBe(toJsonl([b, a]));
  });
});

describe("golden helper: key order", () => {
  test("keys are serialised in sorted order, regardless of input order", () => {
    expect(toJsonl([{ z: 1, a: 2, m: 3 }])).toBe('{"a":2,"m":3,"z":1}\n');
  });

  test("nested object keys are sorted too", () => {
    expect(toJsonl([{ event: "x", record: { z: 1, a: 2 } }])).toBe('{"event":"x","record":{"a":2,"z":1}}\n');
  });
});

describe("expectGolden", () => {
  test("passes when the golden file matches", () => {
    const url = tmpGoldenUrl();
    writeFileSync(url, toJsonl([{ event: "run", exit: 0 }]));
    expect(() => expectGolden([{ event: "run", exit: 0 }], url)).not.toThrow();
  });

  test("fails when the events differ from the golden", () => {
    const url = tmpGoldenUrl();
    writeFileSync(url, toJsonl([{ event: "run", exit: 0 }]));
    expect(() => expectGolden([{ event: "run", exit: 1 }], url)).toThrow();
  });

  test("throws on a missing golden, without UPDATE_GOLDENS", () => {
    const url = tmpGoldenUrl();
    const prev = process.env.UPDATE_GOLDENS;
    delete process.env.UPDATE_GOLDENS;
    try {
      expect(() => expectGolden([{ event: "run" }], url)).toThrow(/no golden/);
    } finally {
      if (prev === undefined) delete process.env.UPDATE_GOLDENS;
      else process.env.UPDATE_GOLDENS = prev;
    }
  });

  test("with UPDATE_GOLDENS=1 (and not CI) it writes the golden instead of throwing", () => {
    const url = tmpGoldenUrl();
    const prevUpdate = process.env.UPDATE_GOLDENS;
    const prevCi = process.env.CI;
    process.env.UPDATE_GOLDENS = "1";
    delete process.env.CI;
    try {
      const events = [{ event: "run", exit: 0 }];
      expect(() => expectGolden(events, url)).not.toThrow();
      expect(readFileSync(url, "utf8")).toBe(toJsonl(events));
    } finally {
      if (prevUpdate === undefined) delete process.env.UPDATE_GOLDENS;
      else process.env.UPDATE_GOLDENS = prevUpdate;
      if (prevCi === undefined) delete process.env.CI;
      else process.env.CI = prevCi;
    }
  });

  test("refuses UPDATE_GOLDENS=1 in CI", () => {
    const url = tmpGoldenUrl();
    const prevUpdate = process.env.UPDATE_GOLDENS;
    const prevCi = process.env.CI;
    process.env.UPDATE_GOLDENS = "1";
    process.env.CI = "1";
    try {
      expect(() => expectGolden([{ event: "run" }], url)).toThrow(/CI/);
    } finally {
      if (prevUpdate === undefined) delete process.env.UPDATE_GOLDENS;
      else process.env.UPDATE_GOLDENS = prevUpdate;
      if (prevCi === undefined) delete process.env.CI;
      else process.env.CI = prevCi;
    }
  });
});
