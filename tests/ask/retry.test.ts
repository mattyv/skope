// Shared retry rules (SPEC §6.2), tested directly since jev and openrouter
// both build on fetchWithRetry.

import { describe, expect, test, vi } from "vitest";
import { ConfigError, fetchWithRetry } from "../../src/ask/retry.js";

const ok = () => new Response("{}", { status: 200 });
const status = (s: number, headers?: Record<string, string>) => new Response("{}", { status: s, headers });

function fakeSleep() {
  const waits: number[] = [];
  return { sleep: async (ms: number) => void waits.push(ms), waits };
}

describe("fetchWithRetry (SPEC §6.2)", () => {
  test("ask.retries outside 0-3 is E-CONFIG", async () => {
    const { sleep } = fakeSleep();
    await expect(fetchWithRetry(async () => ok(), { timeoutMs: 100, retries: 4 }, { fetch, sleep })).rejects.toThrow(ConfigError);
    await expect(fetchWithRetry(async () => ok(), { timeoutMs: 100, retries: -1 }, { fetch, sleep })).rejects.toThrow(ConfigError);
  });

  test("a successful first attempt makes no retry", async () => {
    const build = vi.fn(async () => ok());
    const { sleep } = fakeSleep();
    const res = await fetchWithRetry(build, { timeoutMs: 100, retries: 3 }, { fetch, sleep });
    expect(res?.status).toBe(200);
    expect(build).toHaveBeenCalledTimes(1);
  });

  test("ask.retries: 0 makes exactly one attempt on a 500", async () => {
    const build = vi.fn(async () => status(500));
    const { sleep } = fakeSleep();
    await fetchWithRetry(build, { timeoutMs: 100, retries: 0 }, { fetch, sleep });
    expect(build).toHaveBeenCalledTimes(1);
  });

  test("ask.retries: 3 makes four attempts total, backing off 500ms then doubling", async () => {
    const build = vi.fn(async () => status(500));
    const { sleep, waits } = fakeSleep();
    await fetchWithRetry(build, { timeoutMs: 1000, retries: 3 }, { fetch, sleep });
    expect(build).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([500, 1000, 2000]);
  });

  test("a timeout (network throw) counts as a retryable attempt", async () => {
    const build = vi.fn(async () => {
      throw new Error("aborted");
    });
    const { sleep } = fakeSleep();
    const res = await fetchWithRetry(build, { timeoutMs: 100, retries: 2 }, { fetch, sleep });
    expect(res).toBeNull();
    expect(build).toHaveBeenCalledTimes(3);
  });

  test("429 with retry-after inside the timeout waits that long, not the backoff", async () => {
    const build = vi
      .fn()
      .mockResolvedValueOnce(status(429, { "retry-after": "1" }))
      .mockResolvedValueOnce(ok());
    const { sleep, waits } = fakeSleep();
    const res = await fetchWithRetry(build, { timeoutMs: 5000, retries: 3 }, { fetch, sleep });
    expect(res?.status).toBe(200);
    expect(waits).toEqual([1000]);
  });

  test("429 with retry-after exactly equal to the timeout still retries (no longer than, SPEC §6.2)", async () => {
    const build = vi
      .fn()
      .mockResolvedValueOnce(status(429, { "retry-after": "5" }))
      .mockResolvedValueOnce(ok());
    const { sleep, waits } = fakeSleep();
    const res = await fetchWithRetry(build, { timeoutMs: 5000, retries: 3 }, { fetch, sleep });
    expect(res?.status).toBe(200);
    expect(waits).toEqual([5000]);
  });

  test("429 with retry-after beyond the timeout stops retrying", async () => {
    const build = vi.fn(async () => status(429, { "retry-after": "10" }));
    const { sleep, waits } = fakeSleep();
    const res = await fetchWithRetry(build, { timeoutMs: 5000, retries: 3 }, { fetch, sleep });
    expect(res?.status).toBe(429);
    expect(build).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  test("a non-retryable status (413) returns immediately with no retry", async () => {
    const build = vi.fn(async () => status(413));
    const { sleep } = fakeSleep();
    const res = await fetchWithRetry(build, { timeoutMs: 100, retries: 3 }, { fetch, sleep });
    expect(res?.status).toBe(413);
    expect(build).toHaveBeenCalledTimes(1);
  });
});
