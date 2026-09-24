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
      request_sha256: `sha256:${"0".repeat(64)}`,
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

  test("nested records are normalised too, and key order doesn't matter", () => {
    const a = { event: "handoff_record", record: { run_id: "r-1", host: "h", reason: "gate_failed", skill: "disk-full" } };
    const b = { record: { skill: "disk-full", reason: "gate_failed", host: "h2", run_id: "r-9" }, event: "handoff_record" };
    expect(toJsonl([a])).toBe(toJsonl([b]));
    expect(normalise([a])).toEqual([{ event: "handoff_record", record: { reason: "gate_failed", skill: "disk-full" } }]);
  });

  test("skop's version and build identity don't break goldens", () => {
    const a = { event: "run_start", skop_version: "0.1.0", skop_build: "aaa", dry_run: true };
    const b = { event: "run_start", skop_version: "0.2.0", skop_build: "bbb", dry_run: true };
    expect(toJsonl([a])).toBe(toJsonl([b]));
  });

  test("a handoff record's build identity doesn't break goldens", () => {
    const rec = (build: string) => ({ event: "handoff_record", record: { reason: "deadline", skop: { version: "0.1.0", build } } });
    expect(toJsonl([rec("aaa")])).toBe(toJsonl([rec("bbb")]));
  });

  test("a skill variable named path or host is still compared", () => {
    const rec = (path: string) => ({ event: "handoff_record", record: { variables: { path, host: path } } });
    expect(toJsonl([rec("/var")])).not.toBe(toJsonl([rec("/tmp")]));
    const ask = (host: string) => ({ event: "ask", probs: { host: 0.9, path: 0.1 }, chosen: host });
    expect(toJsonl([ask("host")])).not.toBe(toJsonl([ask("path")]));
  });

  // G3: page/handoff_page text (and anything else) embeds the run's actual host, run_id and
  // run dir. Normalisation replaces those exact substrings, taken from run_start, with
  // placeholders in every string value.
  describe("G3: host/run_id/run_dir substitution from run_start", () => {
    test("a substring of the run's host, run_id and run_dir is replaced with placeholders", () => {
      const events = [
        { event: "run_start", host: "hk-app-03", run_id: "r-8f2c", run_dir: "/tmp/skop/runs/r-8f2c" },
        { event: "page", text: "hk-app-03: skop disk-full handed off. Record: /tmp/skop/runs/r-8f2c/handoff.json" },
      ];
      const [, page] = normalise(events) as [object, { text: string }];
      expect(page.text).toBe("<host>: skop disk-full handed off. Record: <run_dir>/handoff.json");
    });

    test("unrelated text is left untouched", () => {
      const events = [
        { event: "run_start", host: "hk-app-03", run_id: "r-8f2c", run_dir: "/tmp/skop/runs/r-8f2c" },
        { event: "run", stdout_tail: "91% used on /var, no relation to the run's own host or id" },
      ];
      const [, run] = normalise(events) as [object, { stdout_tail: string }];
      expect(run.stdout_tail).toBe("91% used on /var, no relation to the run's own host or id");
    });

    test("with no run_start event, nothing is replaced", () => {
      const events = [{ event: "page", text: "hk-app-03: some text with r-8f2c and /tmp/skop/runs/r-8f2c in it" }];
      const [page] = normalise(events) as [{ text: string }];
      expect(page.text).toBe("hk-app-03: some text with r-8f2c and /tmp/skop/runs/r-8f2c in it");
    });
  });
});
