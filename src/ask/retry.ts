// Shared timeout and retry rules for every backend (SPEC §6.2): each
// attempt times out after `timeout_ms`; retry up to `retries` times (0-3)
// on a timeout, a connection error, 408, 429 or 5xx; wait 500ms before the
// first retry, doubling each time; on 429, wait for `retry-after` instead,
// if it's no longer than the timeout, otherwise stop retrying. Anything
// else (2xx, or a non-retryable error status like 413) returns immediately.
//
// The timeout covers the whole attempt, body included: a response whose
// headers arrive fine but whose body stalls (a slow-loris style hang, or
// a mock that just never closes its stream) must still time out and count
// as a retryable attempt, not hang forever. So `build`'s Response is read
// to completion (as text) inside the same timed window as the request
// itself, and callers get that text back instead of a live Response.

export interface RetryConfig {
  timeoutMs: number;
  retries: number;
}

export interface HttpDeps {
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class ConfigError extends Error {
  readonly code = "E-CONFIG";
}

export function checkRetries(retries: number): void {
  if (!Number.isInteger(retries) || retries < 0 || retries > 3) {
    throw new ConfigError(`ask.retries must be an integer 0-3, got ${retries}`);
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** One attempt's outcome: status, headers and the full body text, all read
 * within the timed window. */
export interface Attempt {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
}

async function runAttempt(build: (signal: AbortSignal) => Promise<Response>, signal: AbortSignal): Promise<Attempt> {
  const res = await build(signal);
  const text = await res.text();
  return { status: res.status, ok: res.ok, headers: res.headers, text };
}

/** Races `promise` against `timeoutMs`, aborting `controller` either way so
 * a real fetch's body stream is actually cancelled, not just abandoned. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
    promise.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Runs `build` under the shared retry rules. `build` performs one HTTP
 * attempt with the given AbortSignal and returns its Response, or throws
 * on a network error. The response body is read to completion inside the
 * same timed attempt, so a stalled body times out too. Returns the last
 * attempt, or `null` if every attempt timed out or failed to connect.
 */
export async function fetchWithRetry(
  build: (signal: AbortSignal) => Promise<Response>,
  cfg: RetryConfig,
  deps: HttpDeps,
): Promise<Attempt | null> {
  checkRetries(cfg.retries);
  const sleep = deps.sleep ?? defaultSleep;
  let backoffMs = 500;

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    let res: Attempt | null;
    try {
      res = await withTimeout(runAttempt(build, controller.signal), cfg.timeoutMs, controller);
    } catch {
      res = null; // timeout (headers or body), or a connection error
    }

    const retryable = res === null || retryableStatus(res.status);
    if (!retryable) return res;
    if (attempt >= cfg.retries) return res; // exhausted: return the last attempt as-is

    if (res && res.status === 429) {
      const header = res.headers.get("retry-after");
      const raMs = header !== null && Number.isFinite(Number(header)) ? Number(header) * 1000 : null;
      if (raMs === null || raMs > cfg.timeoutMs) return res; // beyond the timeout: stop retrying
      await sleep(raMs);
    } else {
      await sleep(backoffMs);
      backoffMs *= 2;
    }
  }
}
