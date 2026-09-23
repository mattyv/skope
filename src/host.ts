// The host loop (SPEC §5.2): call Step, emit its events, answer its
// request with a handler, and repeat until the run is done.

import { type CoreEvent, type Kind, type Outcome, Run, type Section } from "./core.js";

export type ExecHandler = (req: { kind: Kind; cmd: string; src: number }) => Promise<{ exit: number }>;

export async function run(section: Section, opts: { dry: boolean }, exec: ExecHandler): Promise<{ events: CoreEvent[]; outcome: Outcome }> {
  const r = new Run(section, opts);
  const events: CoreEvent[] = [];
  let response: { exit: number } | null = null;
  // P1 bounds a run at 2 steps per statement plus the last. A core that
  // breaks that must fail here, not hang the host.
  const limit = 2 * section.body.length + 1;
  for (let steps = 1; ; steps++) {
    if (steps > limit) throw new Error(`the core took more than ${limit} steps, which P1 rules out`);
    const { events: evs, next } = r.step(response);
    events.push(...evs);
    if ("done" in next) return { events, outcome: next.done };
    response = await exec(next.exec);
  }
}
