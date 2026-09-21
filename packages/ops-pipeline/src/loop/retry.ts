/**
 * Retry with exponential backoff + optional jitter for transient stage failures.
 */

export type RetryOptions = {
  /** Max retry attempts after the first try (total tries = retries + 1). */
  retries: number;
  minDelayMs: number;
  maxDelayMs: number;
  /** When false, delay is exact backoff without random jitter. Default true. */
  jitter?: boolean;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** Injectable sleep for offline tests. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function computeDelay(attempt: number, opts: RetryOptions): number {
  const exp = Math.min(opts.maxDelayMs, opts.minDelayMs * 2 ** Math.max(0, attempt - 1));
  if (opts.jitter === false) return exp;
  // Full jitter in [0, exp]
  return Math.floor(Math.random() * (exp + 1));
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;
  const totalTries = Math.max(0, opts.retries) + 1;

  for (let attempt = 1; attempt <= totalTries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retriesLeft = totalTries - attempt;
      if (retriesLeft <= 0) break;
      if (opts.shouldRetry && !opts.shouldRetry(err, attempt)) break;
      const delayMs = computeDelay(attempt, opts);
      opts.onRetry?.(err, attempt, delayMs);
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Heuristic: network / 5xx / timeout-like errors are retryable by default. */
export function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|HTTP 5\d\d|temporar|unavailable|rate.?limit/i.test(
    msg,
  );
}
