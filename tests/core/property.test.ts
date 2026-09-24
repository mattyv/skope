// Many random runs of the example skills (P2, P3 at run time). A seeded
// random host answers every request however it likes; the proofs say the
// outcome is the same for all of them, and this checks the compiled core.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { Interp } from "../../src/interp.js";
import type { CoreEvent, Next, Response } from "../../src/step.js";
import { answer, BUILTINS, fail, ok, timeout } from "./helpers.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../../contracts/examples/${name}.core.json`, import.meta.url), "utf8"));
const SKILLS: { prog: unknown; params: Record<string, string | number> }[] = [
  { prog: load("disk-full"), params: { mount: "/", threshold: 85, target: 80 } },
  { prog: load("cert-expiry"), params: { domain: "example.com", warn_seconds: 1209600 } },
];

// mulberry32: small, seeded, good enough to spread choices.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function respond(n: Next, r: () => number): Response {
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)] as T;
  switch (n.kind) {
    case "exec":
      // Mostly success, so runs get deep enough to reach their effects.
      if (r() < 0.8) return ok("91%");
      return pick<Response>([ok("42%"), ok("n/a"), fail(), timeout, { kind: "deadline" }]);
    case "ask": {
      const ids = n.request.options.map((o) => o.id);
      const sure = pick(ids);
      const probs = Object.fromEntries(ids.map((id) => [id, id === sure ? 0.99 : 0.01 / (ids.length - 1)]));
      if (r() < 0.8) return answer(probs);
      return pick<Response>([
        answer(Object.fromEntries(ids.map((id) => [id, 1 / ids.length]))),
        { kind: "ask_failed", error: "unavailable", backend: "fake" },
      ]);
    }
    case "page":
      return { kind: "page", ok: r() < 0.5 };
    case "choose":
      return { kind: "picked", i: Math.floor(r() * n.n) };
    case "done":
      throw new Error("no response to done");
  }
}

function runOnce(prog: unknown, params: Record<string, string | number>, dry: boolean, seed: number) {
  const r = rng(seed);
  const interp = new Interp(prog, { params, builtins: BUILTINS, dry, mode: "concrete" });
  const nexts: Next[] = [];
  const events: CoreEvent[] = [];
  let t = interp.step({ kind: "none" });
  for (;;) {
    nexts.push(t.next);
    events.push(...t.events);
    if (t.next.kind === "done") return { nexts, events };
    t = interp.step(respond(t.next, r));
  }
}

describe("random runs of the example skills", () => {
  const RUNS = 150;
  const SLOW = 120_000;

  test(
    "dry run never hands out a do or a page, and the case is exercised (P3)",
    () => {
      let wouldDo = 0;
      for (const { prog, params } of SKILLS) {
        for (let seed = 0; seed < RUNS; seed++) {
          const { nexts, events } = runOnce(prog, params, true, seed);
          for (const n of nexts) {
            expect(n.kind).not.toBe("page");
            if (n.kind === "exec") expect(n.exec).not.toBe("do");
          }
          expect(events.some((e) => e.event === "effect_start" || e.event === "page")).toBe(false);
          wouldDo += events.filter((e) => e.event === "would_do").length;
        }
      }
      // The generator must reach the interesting case: plenty of runs get to a `do`.
      expect(wouldDo).toBeGreaterThan(25);
    },
    SLOW,
  );

  test(
    "the same runs with --apply do hand out do commands (the control)",
    () => {
      let dos = 0;
      for (const { prog, params } of SKILLS) {
        for (let seed = 0; seed < RUNS; seed++) {
          dos += runOnce(prog, params, false, seed).nexts.filter((n) => n.kind === "exec" && n.exec === "do").length;
        }
      }
      expect(dos).toBeGreaterThan(25);
    },
    SLOW,
  );

  test(
    "every run ends in exactly one outcome, the last event (P2)",
    () => {
      for (const { prog, params } of SKILLS) {
        for (let seed = 0; seed < RUNS; seed++) {
          const { nexts, events } = runOnce(prog, params, seed % 2 === 0, seed);
          expect(nexts.filter((n) => n.kind === "done")).toHaveLength(1);
          expect(nexts.at(-1)?.kind).toBe("done");
          expect(events.filter((e) => e.event === "outcome")).toHaveLength(1);
          expect(events.at(-1)?.event).toBe("outcome");
        }
      }
    },
    SLOW,
  );
});
