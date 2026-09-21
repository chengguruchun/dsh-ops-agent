import type { OpsConfig } from '../config.js';
import { requireMetricsUrl } from '../config.js';

export type MetricsQuery = {
  query?: string;
  service?: string;
  namespace?: string;
};

export type MetricsResult = {
  text: string;
  requestSummary: string;
};

export type FetchFn = typeof fetch;

export async function queryMetrics(
  cfg: OpsConfig,
  q: MetricsQuery = {},
  fetchFn: FetchFn = fetch,
): Promise<MetricsResult> {
  const base = requireMetricsUrl(cfg);
  const url = new URL(base);
  if (q.query) url.searchParams.set('query', q.query);
  if (q.service) url.searchParams.set('service', q.service);
  if (q.namespace) url.searchParams.set('namespace', q.namespace);

  const res = await fetchFn(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`metrics HTTP ${res.status}: ${text.slice(0, 500)}`);
  return { text, requestSummary: `GET ${url.toString()}` };
}
