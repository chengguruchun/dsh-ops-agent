import type { OpsConfig } from '../config.js';
import { kubectlContextArgs, kubectlEnv } from '../config.js';
import type { ExecFn } from '../exec.js';
import { assertOk } from '../exec.js';

export type LogQuery = {
  service?: string;
  namespace?: string;
  since?: string;
  query?: string;
  pod?: string;
  tailLines?: number;
};

export type LogQueryResult = {
  provider: OpsConfig['logProvider'];
  text: string;
  requestSummary: string;
};

export type FetchFn = typeof fetch;

export async function queryLogs(
  cfg: OpsConfig,
  exec: ExecFn,
  q: LogQuery,
  fetchFn: FetchFn = fetch,
): Promise<LogQueryResult> {
  switch (cfg.logProvider) {
    case 'kubectl':
      return queryKubectlLogs(cfg, exec, q);
    case 'loki':
      return queryLokiLogs(cfg, q, fetchFn);
    case 'http':
      return queryHttpLogs(cfg, q, fetchFn);
    default:
      throw new Error(`Unknown OPS_LOG_PROVIDER: ${String(cfg.logProvider)}`);
  }
}

async function queryKubectlLogs(
  cfg: OpsConfig,
  exec: ExecFn,
  q: LogQuery,
): Promise<LogQueryResult> {
  const args = ['logs', ...kubectlContextArgs(cfg)];
  if (q.namespace) args.push('-n', q.namespace);
  if (q.since) args.push(`--since=${q.since}`);
  if (q.tailLines != null) args.push(`--tail=${q.tailLines}`);
  else args.push('--tail=200');

  if (q.pod) args.push(q.pod);
  else if (q.service) args.push('-l', `app=${q.service}`);
  else throw new Error('kubectl logs requires pod or service');

  const result = await exec({ cmd: 'kubectl', args, env: kubectlEnv(cfg) });
  assertOk(result, 'kubectl logs');
  return {
    provider: 'kubectl',
    text: result.stdout,
    requestSummary: `kubectl ${args.join(' ')}`,
  };
}

async function queryLokiLogs(
  cfg: OpsConfig,
  q: LogQuery,
  fetchFn: FetchFn,
): Promise<LogQueryResult> {
  if (!cfg.lokiUrl) throw new Error('OPS_LOKI_URL required for loki log provider');
  const end = Date.now() * 1_000_000;
  const start = end - 15 * 60 * 1_000_000_000;
  let logql = q.query;
  if (!logql) {
    const parts: string[] = [];
    if (q.namespace) parts.push(`namespace="${q.namespace}"`);
    if (q.service) parts.push(`app="${q.service}"`);
    logql = `{${parts.join(',') || 'job=~".+"'}}`;
  }
  const url = new URL('/loki/api/v1/query_range', cfg.lokiUrl.replace(/\/$/, '') + '/');
  url.searchParams.set('query', logql);
  url.searchParams.set('start', String(start));
  url.searchParams.set('end', String(end));
  url.searchParams.set('limit', '200');

  const res = await fetchFn(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Loki query failed HTTP ${res.status}: ${text.slice(0, 500)}`);
  return { provider: 'loki', text, requestSummary: `GET ${url.pathname}?query=...` };
}

async function queryHttpLogs(
  cfg: OpsConfig,
  q: LogQuery,
  fetchFn: FetchFn,
): Promise<LogQueryResult> {
  if (!cfg.logHttpUrl) throw new Error('OPS_LOG_HTTP_URL required for http log provider');
  const url = new URL(cfg.logHttpUrl);
  if (q.service) url.searchParams.set('service', q.service);
  if (q.namespace) url.searchParams.set('namespace', q.namespace);
  if (q.since) url.searchParams.set('since', q.since);
  if (q.query) url.searchParams.set('query', q.query);
  if (q.pod) url.searchParams.set('pod', q.pod);

  const res = await fetchFn(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP log query failed HTTP ${res.status}: ${text.slice(0, 500)}`);
  return { provider: 'http', text, requestSummary: `GET ${url.toString()}` };
}
