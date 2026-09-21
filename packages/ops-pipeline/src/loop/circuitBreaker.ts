/**
 * Circuit breaker: after N consecutive failures, open and fail-fast for cooldownMs.
 * States: closed → open → half-open (one probe) → closed/open.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export type CircuitBreakerOptions = {
  name: string;
  failureThreshold: number;
  cooldownMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
};

export type CircuitBreakerSnapshot = {
  name: string;
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
  totalSuccesses: number;
  totalFailures: number;
};

export class CircuitOpenError extends Error {
  readonly circuit: string;
  readonly retryAfterMs: number;

  constructor(circuit: string, retryAfterMs: number) {
    super(`Circuit breaker open for "${circuit}" (retry after ~${retryAfterMs}ms)`);
    this.name = 'CircuitOpenError';
    this.circuit = circuit;
    this.retryAfterMs = retryAfterMs;
  }
}

export class CircuitBreaker {
  readonly name: string;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private totalSuccesses = 0;
  private totalFailures = 0;

  constructor(opts: CircuitBreakerOptions) {
    this.name = opts.name;
    this.failureThreshold = Math.max(1, opts.failureThreshold);
    this.cooldownMs = Math.max(0, opts.cooldownMs);
    this.now = opts.now ?? (() => Date.now());
  }

  getState(): CircuitState {
    this.maybeTransitionFromOpen();
    return this.state;
  }

  snapshot(): CircuitBreakerSnapshot {
    this.maybeTransitionFromOpen();
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
    };
  }

  restore(snap: Partial<CircuitBreakerSnapshot>): void {
    if (snap.state) this.state = snap.state;
    if (snap.consecutiveFailures != null) this.consecutiveFailures = snap.consecutiveFailures;
    if (snap.openedAt !== undefined) this.openedAt = snap.openedAt;
    if (snap.totalSuccesses != null) this.totalSuccesses = snap.totalSuccesses;
    if (snap.totalFailures != null) this.totalFailures = snap.totalFailures;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionFromOpen();
    if (this.state === 'open') {
      const retryAfter = this.openedAt == null ? this.cooldownMs : Math.max(0, this.cooldownMs - (this.now() - this.openedAt));
      throw new CircuitOpenError(this.name, retryAfter);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private maybeTransitionFromOpen(): void {
    if (this.state !== 'open' || this.openedAt == null) return;
    if (this.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half-open';
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.totalSuccesses += 1;
    this.openedAt = null;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    this.totalFailures += 1;
    if (this.state === 'half-open' || this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }
}

export type BreakerRegistry = Map<string, CircuitBreaker>;

export function createBreakerRegistry(
  names: string[],
  defaults: { failureThreshold: number; cooldownMs: number; now?: () => number },
): BreakerRegistry {
  const map: BreakerRegistry = new Map();
  for (const name of names) {
    map.set(
      name,
      new CircuitBreaker({
        name,
        failureThreshold: defaults.failureThreshold,
        cooldownMs: defaults.cooldownMs,
        now: defaults.now,
      }),
    );
  }
  return map;
}

export function snapshotBreakers(reg: BreakerRegistry): CircuitBreakerSnapshot[] {
  return [...reg.values()].map((b) => b.snapshot());
}

export function restoreBreakers(reg: BreakerRegistry, snaps: CircuitBreakerSnapshot[]): void {
  for (const snap of snaps) {
    const b = reg.get(snap.name);
    if (b) b.restore(snap);
  }
}
