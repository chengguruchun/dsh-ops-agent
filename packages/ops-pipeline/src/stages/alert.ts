export type AlertSeverity = 'critical' | 'warning' | 'info' | 'unknown';

export type NormalizedAlert = {
  fingerprint: string;
  name: string;
  severity: AlertSeverity;
  status: 'firing' | 'resolved' | 'unknown';
  summary: string;
  description: string;
  service?: string;
  namespace?: string;
  pod?: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
  generatorUrl?: string;
  raw: unknown;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

function mapSeverity(raw: string): AlertSeverity {
  const s = raw.toLowerCase();
  if (s === 'critical' || s === 'error' || s === 'fatal') return 'critical';
  if (s === 'warning' || s === 'warn') return 'warning';
  if (s === 'info' || s === 'none' || s === 'debug') return 'info';
  return 'unknown';
}

function mapStatus(raw: string): NormalizedAlert['status'] {
  const s = raw.toLowerCase();
  if (s === 'firing' || s === 'active' || s === 'open') return 'firing';
  if (s === 'resolved' || s === 'ok' || s === 'closed') return 'resolved';
  return 'unknown';
}

/**
 * Normalize Alertmanager webhook payloads, single alerts, or lightly-shaped custom JSON.
 */
export function normalizeAlert(input: unknown): NormalizedAlert {
  const root = asRecord(input);

  // Alertmanager webhook: { alerts: [ ... ], status, commonLabels, ... }
  if (Array.isArray(root.alerts) && root.alerts.length > 0) {
    return normalizeOneAlert(root.alerts[0], root);
  }

  // Already a single alert-shaped object
  if (root.labels != null || root.annotations != null || root.alertname != null || root.name != null) {
    return normalizeOneAlert(root, root);
  }

  // Nested .alert
  if (root.alert != null) {
    return normalizeOneAlert(root.alert, root);
  }

  throw new Error('normalizeAlert: unrecognized alert payload shape');
}

function normalizeOneAlert(alertRaw: unknown, parentRaw: unknown): NormalizedAlert {
  const alert = asRecord(alertRaw);
  const parent = asRecord(parentRaw);
  const labels = {
    ...stringMap(parent.commonLabels),
    ...stringMap(alert.labels),
  };
  const annotations = {
    ...stringMap(parent.commonAnnotations),
    ...stringMap(alert.annotations),
  };

  const name =
    str(labels.alertname) ||
    str(alert.alertname) ||
    str(alert.name) ||
    str(annotations.summary) ||
    'unknown-alert';

  const severity = mapSeverity(str(labels.severity) || str(alert.severity) || 'unknown');
  const status = mapStatus(str(alert.status) || str(parent.status) || 'unknown');
  const summary = str(annotations.summary) || str(alert.summary) || name;
  const description =
    str(annotations.description) || str(alert.description) || str(annotations.message) || summary;

  const fingerprint =
    str(alert.fingerprint) ||
    str(alert.id) ||
    `${name}|${labels.service ?? ''}|${labels.namespace ?? ''}|${labels.pod ?? ''}`;

  return {
    fingerprint,
    name,
    severity,
    status,
    summary,
    description,
    service: emptyToUndef(labels.service || labels.app || labels.job),
    namespace: emptyToUndef(labels.namespace || labels.ns),
    pod: emptyToUndef(labels.pod || labels.pod_name),
    labels,
    annotations,
    startsAt: emptyToUndef(str(alert.startsAt) || str(alert.starts_at)),
    endsAt: emptyToUndef(str(alert.endsAt) || str(alert.ends_at)),
    generatorUrl: emptyToUndef(str(alert.generatorURL) || str(alert.generatorUrl)),
    raw: alertRaw,
  };
}

function stringMap(v: unknown): Record<string, string> {
  const r = asRecord(v);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(r)) {
    if (val == null) continue;
    out[k] = typeof val === 'string' ? val : String(val);
  }
  return out;
}

function emptyToUndef(s: string | undefined): string | undefined {
  if (s == null || s === '') return undefined;
  return s;
}
