import { describe, expect, test } from "vitest";
import { normalise, toJsonl } from "./helpers/golden.js";

describe("golden helper (SPEC §12.3)", () => {
  test("drops exactly the fields that differ between runs", () => {
    const e = {
      ts: "2026-09-23T10:00:00Z",
      run_id: "r-1",
      host: "h",
      skill_hash: "sha256:x",
      event: "run",
      cmd: "df",
      exit: 0,
      ms: 12,
      request_path: "/tmp/a",
    };
    expect(normalise([e])).toEqual([{ event: "run", cmd: "df", exit: 0 }]);
  });

  test("two runs that differ only in varying fields produce the same golden", () => {
    const a = { ts: "2026-09-23T10:00:00Z", run_id: "r-1", event: "would_do", cmd: "x" };
    const b = { ts: "2026-09-24T11:30:00Z", run_id: "r-2", event: "would_do", cmd: "x" };
    expect(toJsonl([a])).toBe(toJsonl([b]));
  });

  test("a change in a meaningful field changes the golden", () => {
    expect(toJsonl([{ event: "run", exit: 0 }])).not.toBe(toJsonl([{ event: "run", exit: 1 }]));
  });
});
