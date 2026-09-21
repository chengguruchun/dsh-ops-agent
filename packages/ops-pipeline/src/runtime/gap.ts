/**
 * V0.4 Expected vs Actual Gap after verify
 */

import { newRuntimeId } from './ids.js';

export type ExpectedState = {
  deployment?: string;
  namespace?: string;
  imageRef?: string;
  replicas?: number;
  readyReplicas?: number;
  rolloutComplete?: boolean;
  custom?: Record<string, unknown>;
};

export type ActualState = {
  deployment?: string;
  namespace?: string;
  imageRef?: string;
  replicas?: number;
  readyReplicas?: number;
  rolloutComplete?: boolean;
  rolloutText?: string;
  custom?: Record<string, unknown>;
  raw?: unknown;
};

export type GapItem = {
  field: string;
  expected: unknown;
  actual: unknown;
  severity: 'info' | 'warning' | 'blocker';
};

export type GapResult = {
  id: string;
  at: string;
  ok: boolean;
  items: GapItem[];
  summary: string;
  /** Optional hint for the next AgentLoop action / phase. */
  nextActionHint?: string;
  expected: ExpectedState;
  actual: ActualState;
};

export type ComputeGapOptions = {
  /** Injectable actuals (tests / DI). */
  actual?: ActualState;
  /** Fetch actuals when not injected. */
  fetchActual?: () => Promise<ActualState> | ActualState;
  now?: () => string;
  newId?: () => string;
};

export async function computeGap(
  expected: ExpectedState,
  opts: ComputeGapOptions = {},
): Promise<GapResult> {
  const actual =
    opts.actual ??
    (opts.fetchActual ? await opts.fetchActual() : ({} as ActualState));

  const items: GapItem[] = [];

  const compare = (
    field: string,
    exp: unknown,
    act: unknown,
    severity: GapItem['severity'] = 'blocker',
  ) => {
    if (exp === undefined) return;
    if (act === undefined) {
      items.push({ field, expected: exp, actual: act, severity: 'warning' });
      return;
    }
    if (exp !== act) {
      items.push({ field, expected: exp, actual: act, severity });
    }
  };

  compare('deployment', expected.deployment, actual.deployment, 'warning');
  compare('namespace', expected.namespace, actual.namespace, 'warning');
  compare('imageRef', expected.imageRef, actual.imageRef, 'blocker');
  compare('replicas', expected.replicas, actual.replicas, 'blocker');
  compare('readyReplicas', expected.readyReplicas, actual.readyReplicas, 'blocker');
  compare('rolloutComplete', expected.rolloutComplete, actual.rolloutComplete, 'blocker');

  if (expected.custom) {
    for (const [k, v] of Object.entries(expected.custom)) {
      const act = actual.custom?.[k];
      compare(`custom.${k}`, v, act, 'warning');
    }
  }

  const blockers = items.filter((i) => i.severity === 'blocker');
  const ok = blockers.length === 0;
  let nextActionHint: string | undefined;
  if (!ok) {
    if (items.some((i) => i.field === 'imageRef')) {
      nextActionHint = 're-release with corrected imageRef then re-verify';
    } else if (items.some((i) => i.field === 'rolloutComplete' || i.field === 'readyReplicas')) {
      nextActionHint = 'wait/retry verify or rollback; rollout not healthy';
    } else {
      nextActionHint = 'diagnose gap fields then adjust and re-verify';
    }
  } else if (items.length > 0) {
    nextActionHint = 'soft gaps only — record and continue';
  }

  const summary = ok
    ? items.length === 0
      ? 'expected matches actual'
      : `ok with ${items.length} soft gap(s)`
    : `gap: ${blockers.map((b) => b.field).join(', ')}`;

  return {
    id: (opts.newId ?? (() => newRuntimeId('gap')))(),
    at: (opts.now ?? (() => new Date().toISOString()))(),
    ok,
    items,
    summary,
    nextActionHint,
    expected,
    actual,
  };
}

/** Convenience: build ActualState from verify rollout text heuristics. */
export function actualFromVerifyText(
  text: string,
  base: Partial<ActualState> = {},
): ActualState {
  const rolloutComplete = /successfully rolled out/i.test(text);
  return {
    ...base,
    rolloutComplete,
    rolloutText: text.slice(0, 2000),
  };
}
