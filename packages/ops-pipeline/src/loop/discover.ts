/**
 * Discover phase: synthesize DiscoveryReport from alert + logs + k8s (+ optional GitLab search).
 */

import type { OpsConfig } from '../config.js';
import type { ExecFn } from '../exec.js';
import { normalizeAlert, type NormalizedAlert } from '../stages/alert.js';
import { getEvents, getPods } from '../stages/k8s.js';
import { createGitlabClient } from '../stages/gitlab.js';
import { queryLogsWithFallback, queryMetricsSoft } from './degrade.js';

export type FetchFn = typeof fetch;

export type DiscoveryHypothesis = {
  id: string;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  evidence: string[];
};

export type DiscoveryReport = {
  alert: NormalizedAlert;
  suspectService?: string;
  namespace?: string;
  errorSignatures: string[];
  hypotheses: DiscoveryHypothesis[];
  logs?: { provider: string; textLength: number; sample: string; degraded?: string };
  metrics?: { skipped?: boolean; reason?: string; textLength?: number };
  k8s?: {
    podCount?: number;
    unhealthyPods?: string[];
    eventSample?: string[];
    requestSummary?: string;
  };
  gitlabSearch?: unknown;
  notes: string[];
};

export type DiscoverOptions = {
  alert: unknown;
  /** Pre-normalized alert (skips normalize when provided). */
  normalizedAlert?: NormalizedAlert;
  config: OpsConfig;
  exec: ExecFn;
  fetchFn?: FetchFn;
  skipLogs?: boolean;
  skipK8s?: boolean;
  skipMetrics?: boolean;
  gitlabSearch?: string;
  /** Injected log text for offline tests (skips real log query). */
  injectedLogsText?: string;
  /** Injected k8s pods/events JSON for offline tests. */
  injectedPods?: Record<string, unknown>;
  injectedEvents?: Record<string, unknown>;
};

const ERROR_LINE_RE =
  /\b(ERROR|FATAL|Exception|panic|OOMKilled|CrashLoopBackOff|ImagePullBackOff|Back-off)\b/i;

export async function discover(opts: DiscoverOptions): Promise<DiscoveryReport> {
  const fetchFn = opts.fetchFn ?? fetch;
  const alert = opts.normalizedAlert ?? normalizeAlert(opts.alert);
  const notes: string[] = [];
  const errorSignatures: string[] = [];
  const hypotheses: DiscoveryHypothesis[] = [];

  const suspectService = alert.service;
  const namespace = alert.namespace;

  // Collect signatures from alert text
  for (const piece of [alert.name, alert.summary, alert.description]) {
    if (ERROR_LINE_RE.test(piece)) {
      pushUnique(errorSignatures, piece.slice(0, 200));
    }
  }
  pushUnique(errorSignatures, alert.name);

  let logsSection: DiscoveryReport['logs'];
  if (opts.injectedLogsText != null) {
    const sample = opts.injectedLogsText.slice(0, 1500);
    extractErrorLines(opts.injectedLogsText, errorSignatures);
    logsSection = {
      provider: 'injected',
      textLength: opts.injectedLogsText.length,
      sample,
    };
  } else if (!opts.skipLogs) {
    try {
      const logResult = await queryLogsWithFallback(
        opts.config,
        opts.exec,
        {
          service: suspectService,
          namespace,
          pod: alert.pod,
          since: '1h',
          query: alert.name,
        },
        fetchFn,
      );
      extractErrorLines(logResult.text, errorSignatures);
      logsSection = {
        provider: logResult.provider,
        textLength: logResult.text.length,
        sample: logResult.text.slice(0, 1500),
        degraded: logResult.fallbackUsed
          ? `fallback=${logResult.fallbackUsed} from=${logResult.degradedFrom}`
          : undefined,
      };
      if (logResult.fallbackUsed) {
        notes.push(`logs degraded: used ${logResult.fallbackUsed}`);
      }
    } catch (err) {
      notes.push(`logs failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    notes.push('logs skipped');
  }

  let metricsSection: DiscoveryReport['metrics'];
  if (!opts.skipMetrics) {
    const soft = await queryMetricsSoft(
      opts.config,
      { service: suspectService, namespace, query: alert.name },
      fetchFn,
    );
    if (soft.ok) {
      metricsSection = { textLength: soft.result.text.length };
    } else {
      metricsSection = { skipped: true, reason: soft.reason };
      notes.push(`metrics soft-skip: ${soft.reason}`);
    }
  }

  let k8sSection: DiscoveryReport['k8s'];
  if (opts.injectedPods || opts.injectedEvents) {
    const pods = opts.injectedPods ?? { items: [] };
    const events = opts.injectedEvents ?? { items: [] };
    k8sSection = summarizeK8s(pods, events, 'injected');
    for (const name of k8sSection.unhealthyPods ?? []) {
      pushUnique(errorSignatures, `unhealthy-pod:${name}`);
    }
  } else if (!opts.skipK8s) {
    try {
      const pods = await getPods(opts.config, opts.exec, {
        namespace,
        labelSelector: suspectService ? `app=${suspectService}` : undefined,
      });
      const events = await getEvents(opts.config, opts.exec, { namespace });
      k8sSection = summarizeK8s(pods.data, events.data, `${pods.requestSummary} ; ${events.requestSummary}`);
      for (const name of k8sSection.unhealthyPods ?? []) {
        pushUnique(errorSignatures, `unhealthy-pod:${name}`);
      }
    } catch (err) {
      notes.push(`k8s failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    notes.push('k8s skipped');
  }

  let gitlabSearch: unknown;
  if (
    opts.gitlabSearch &&
    opts.config.gitlabUrl &&
    opts.config.gitlabToken &&
    opts.config.gitlabProject
  ) {
    try {
      const gl = createGitlabClient(opts.config, fetchFn);
      gitlabSearch = await gl.searchCode(opts.gitlabSearch);
    } catch (err) {
      notes.push(`gitlab search failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Hypotheses
  if ((k8sSection?.unhealthyPods?.length ?? 0) > 0) {
    hypotheses.push({
      id: 'k8s-unhealthy',
      summary: `Pods unhealthy: ${(k8sSection!.unhealthyPods ?? []).join(', ')}`,
      confidence: 'high',
      evidence: k8sSection!.unhealthyPods ?? [],
    });
  }
  if (errorSignatures.some((s) => /OOM|memory/i.test(s))) {
    hypotheses.push({
      id: 'oom',
      summary: 'Possible OOM / memory pressure',
      confidence: 'medium',
      evidence: errorSignatures.filter((s) => /OOM|memory/i.test(s)),
    });
  }
  if (errorSignatures.some((s) => /CrashLoop|panic|Exception|FATAL/i.test(s))) {
    hypotheses.push({
      id: 'crash',
      summary: 'Crash / exception signatures in logs or events',
      confidence: 'high',
      evidence: errorSignatures.filter((s) => /CrashLoop|panic|Exception|FATAL/i.test(s)).slice(0, 5),
    });
  }
  if (hypotheses.length === 0) {
    hypotheses.push({
      id: 'alert-driven',
      summary: `Investigate alert ${alert.name} on service ${suspectService ?? 'unknown'}`,
      confidence: 'low',
      evidence: [alert.summary, alert.description].filter(Boolean),
    });
  }

  return {
    alert,
    suspectService,
    namespace,
    errorSignatures,
    hypotheses,
    logs: logsSection,
    metrics: metricsSection,
    k8s: k8sSection,
    gitlabSearch,
    notes,
  };
}

function pushUnique(arr: string[], v: string): void {
  if (!v) return;
  if (!arr.includes(v)) arr.push(v);
}

function extractErrorLines(text: string, into: string[]): void {
  for (const line of text.split(/\r?\n/)) {
    if (ERROR_LINE_RE.test(line)) pushUnique(into, line.trim().slice(0, 240));
    if (into.length > 40) break;
  }
}

function summarizeK8s(
  podsData: Record<string, unknown>,
  eventsData: Record<string, unknown>,
  requestSummary: string,
): NonNullable<DiscoveryReport['k8s']> {
  const items = Array.isArray(podsData.items) ? podsData.items : [];
  const unhealthyPods: string[] = [];
  for (const raw of items) {
    const pod = raw as Record<string, unknown>;
    const meta = (pod.metadata ?? {}) as Record<string, unknown>;
    const status = (pod.status ?? {}) as Record<string, unknown>;
    const name = String(meta.name ?? 'unknown');
    const phase = String(status.phase ?? '');
    const containerStatuses = Array.isArray(status.containerStatuses)
      ? status.containerStatuses
      : [];
    let bad = phase === 'Failed' || phase === 'Unknown';
    for (const cs of containerStatuses) {
      const c = cs as Record<string, unknown>;
      const state = (c.state ?? {}) as Record<string, unknown>;
      const waiting = (state.waiting ?? {}) as Record<string, unknown>;
      const reason = String(waiting.reason ?? '');
      if (/CrashLoop|ImagePull|ErrImage|OOMKilled/i.test(reason)) bad = true;
      if (typeof c.restartCount === 'number' && c.restartCount > 3) bad = true;
    }
    if (bad) unhealthyPods.push(name);
  }

  const eventItems = Array.isArray(eventsData.items) ? eventsData.items : [];
  const eventSample: string[] = [];
  for (const raw of eventItems.slice(-15)) {
    const ev = raw as Record<string, unknown>;
    const type = String(ev.type ?? '');
    const reason = String(ev.reason ?? '');
    const msg = String(ev.message ?? '').slice(0, 120);
    if (type === 'Warning' || /Fail|Error|Kill|BackOff/i.test(reason)) {
      eventSample.push(`${reason}: ${msg}`);
    }
  }

  return {
    podCount: items.length,
    unhealthyPods,
    eventSample,
    requestSummary,
  };
}
