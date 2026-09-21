/**
 * Degradation / fallback helpers.
 *
 * Policies (brief):
 * - Logs: try primary OPS_LOG_PROVIDER; on failure fall back to kubectl if pod/service known.
 * - Metrics: soft-fail — missing URL or query error → continue with empty/skipped result.
 * - Release: helm runs `helm upgrade --install`; HTTP webhook may fall back to script; helm is primary when OPS_RELEASE_PROVIDER=helm.
 * - Review hard-stop is enforced in agentLoop (not here): blockers prevent release.
 */

import type { OpsConfig } from '../config.js';
import type { ExecFn } from '../exec.js';
import { queryLogs, type LogQuery, type LogQueryResult } from '../stages/logs.js';
import { queryMetrics, type MetricsQuery, type MetricsResult } from '../stages/metrics.js';
import { triggerRelease, type ReleasePayload, type ReleaseResult, type HelmReleaseOverrides } from '../stages/release.js';

export type FetchFn = typeof fetch;

export type FallbackAttempt<T> = {
  name: string;
  run: () => Promise<T>;
};

export type FallbackResult<T> = {
  value: T;
  used: string;
  failed: Array<{ name: string; error: string }>;
};

/**
 * Run providers in order until one succeeds.
 */
export async function withFallbackChain<T>(
  attempts: FallbackAttempt<T>[],
): Promise<FallbackResult<T>> {
  const failed: Array<{ name: string; error: string }> = [];
  if (attempts.length === 0) {
    throw new Error('withFallbackChain: no attempts provided');
  }
  for (const attempt of attempts) {
    try {
      const value = await attempt.run();
      return { value, used: attempt.name, failed };
    } catch (err) {
      failed.push({
        name: attempt.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const detail = failed.map((f) => `${f.name}: ${f.error}`).join(' | ');
  throw new Error(`All fallbacks failed: ${detail}`);
}

/**
 * Primary log provider → kubectl fallback when kube context is usable.
 */
export async function queryLogsWithFallback(
  cfg: OpsConfig,
  exec: ExecFn,
  q: LogQuery,
  fetchFn: FetchFn = fetch,
): Promise<LogQueryResult & { degradedFrom?: string; fallbackUsed?: string }> {
  const attempts: FallbackAttempt<LogQueryResult>[] = [
    {
      name: cfg.logProvider,
      run: () => queryLogs(cfg, exec, q, fetchFn),
    },
  ];

  if (cfg.logProvider !== 'kubectl' && (q.pod || q.service)) {
    const kubectlCfg: OpsConfig = { ...cfg, logProvider: 'kubectl' };
    attempts.push({
      name: 'kubectl-fallback',
      run: () => queryLogs(kubectlCfg, exec, q, fetchFn),
    });
  }

  try {
    const result = await withFallbackChain(attempts);
    if (result.failed.length > 0) {
      return {
        ...result.value,
        degradedFrom: result.failed.map((f) => f.name).join(','),
        fallbackUsed: result.used,
      };
    }
    return result.value;
  } catch (err) {
    throw err;
  }
}

/**
 * Soft metrics: never throw for missing config / query failure — return skipped shape.
 */
export async function queryMetricsSoft(
  cfg: OpsConfig,
  q: MetricsQuery,
  fetchFn: FetchFn = fetch,
): Promise<
  | { ok: true; result: MetricsResult }
  | { ok: false; skipped: true; reason: string }
> {
  if (!cfg.metricsHttpUrl) {
    return { ok: false, skipped: true, reason: 'OPS_METRICS_HTTP_URL not set' };
  }
  try {
    const result = await queryMetrics(cfg, q, fetchFn);
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      skipped: true,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Release with optional script fallback when HTTP webhook fails.
 */
export async function triggerReleaseWithFallback(
  cfg: OpsConfig,
  exec: ExecFn,
  payload: ReleasePayload,
  fetchFn: FetchFn = fetch,
  opts: { allowScriptFallback?: boolean; helm?: HelmReleaseOverrides } = {},
): Promise<ReleaseResult & { degradedFrom?: string; fallbackUsed?: string }> {
  const allowScriptFallback = opts.allowScriptFallback !== false;

  if (cfg.releaseProvider === 'script' || cfg.releaseProvider === 'helm') {
    const result = await triggerRelease(cfg, exec, payload, fetchFn, opts.helm);
    return result;
  }

  // Primary: HTTP webhook
  try {
    const result = await triggerRelease(cfg, exec, payload, fetchFn);
    return result;
  } catch (primaryErr) {
    if (!allowScriptFallback || !cfg.releaseScript) {
      throw primaryErr;
    }
    const scriptCfg: OpsConfig = { ...cfg, releaseProvider: 'script' };
    const result = await triggerRelease(scriptCfg, exec, payload, fetchFn);
    return {
      ...result,
      degradedFrom: 'http',
      fallbackUsed: 'script',
    };
  }
}

