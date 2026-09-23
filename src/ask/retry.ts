// Shared timeout and retry rules for every backend (SPEC §6.2): each
// attempt times out after `timeout_ms`; retry up to `retries` times (0-3)
// on a timeout, a connection error, 408, 429 or 5xx; wait 500ms before the
// first retry, doubling each time; on 429, wait for `retry-after` instead,
// if it's no longer than the timeout, otherwise stop retrying. Anything
// else (2xx, or a non-retryable error status like 413) returns immediately.

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

/**
 * Runs `build` under the shared retry rules. `build` performs one HTTP
 * attempt with the given AbortSignal and returns its Response, or throws
 * on a network error. Returns the last Response, or `null` if every
 * attempt timed out or failed to connect.
 */
export async function fetchWithRetry(
  build: (signal: AbortSignal) => Promise<Response>,
  cfg: RetryConfig,
  deps: HttpDeps,
): Promise<Response | null> {
  checkRetries(cfg.retries);
  const sleep = deps.sleep ?? defaultSleep;
  let backoffMs = 500;

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    let res: Response | null;
    try {
      res = await build(controller.signal);
    } catch {
      res = null; // timeout (abort) or a connection error
    } finally {
      clearTimeout(timer);
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
