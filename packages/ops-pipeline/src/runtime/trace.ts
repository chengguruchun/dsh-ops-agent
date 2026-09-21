/**
 * V0.3 Append-only ExecutionTrace
 */

import { newRuntimeId } from './ids.js';
import type {
  ActionRecord,
  DecisionRecord,
  Evidence,
  Observation,
  ResultRecord,
  VerificationRecord,
} from './evidence.js';
import type { RiskDecision } from './riskGate.js';
import type { GapResult } from './gap.js';

export type TraceEventType =
  | 'observation'
  | 'evidence'
  | 'decision'
  | 'action'
  | 'result'
  | 'verification'
  | 'risk'
  | 'gap'
  | 'phase'
  | 'note'
  | 'pause'
  | 'resume';

export type TraceEvent = {
  id: string;
  at: string;
  type: TraceEventType;
  summary: string;
  refId?: string;
  data?: unknown;
};

export type ExecutionTrace = {
  id: string;
  runId: string;
  startedAt: string;
  events: TraceEvent[];
};

export function createExecutionTrace(runId: string, startedAt?: string): ExecutionTrace {
  return {
    id: newRuntimeId('trace'),
    runId,
    startedAt: startedAt ?? new Date().toISOString(),
    events: [],
  };
}

export function appendTraceEvent(
  trace: ExecutionTrace,
  event: Omit<TraceEvent, 'id' | 'at'> & { id?: string; at?: string },
): TraceEvent {
  const full: TraceEvent = {
    id: event.id ?? newRuntimeId('trace'),
    at: event.at ?? new Date().toISOString(),
    type: event.type,
    summary: event.summary,
    refId: event.refId,
    data: event.data,
  };
  trace.events.push(full);
  return full;
}

export function appendObservation(trace: ExecutionTrace, obs: Observation): void {
  appendTraceEvent(trace, {
    type: 'observation',
    summary: obs.summary,
    refId: obs.id,
    data: { source: obs.source },
  });
}

export function appendEvidence(trace: ExecutionTrace, ev: Evidence): void {
  appendTraceEvent(trace, {
    type: 'evidence',
    summary: ev.summary,
    refId: ev.id,
    data: { kind: ev.kind, observationIds: ev.observationIds },
  });
}

export function appendDecision(trace: ExecutionTrace, d: DecisionRecord): void {
  appendTraceEvent(trace, {
    type: 'decision',
    summary: d.summary,
    refId: d.id,
    data: { choice: d.choice, riskLevel: d.riskLevel },
  });
}

export function appendAction(trace: ExecutionTrace, a: ActionRecord): void {
  appendTraceEvent(trace, {
    type: 'action',
    summary: a.summary,
    refId: a.id,
    data: { kind: a.kind, riskLevel: a.riskLevel },
  });
}

export function appendResult(trace: ExecutionTrace, r: ResultRecord): void {
  appendTraceEvent(trace, {
    type: 'result',
    summary: r.summary,
    refId: r.id,
    data: { ok: r.ok, actionId: r.actionId },
  });
}

export function appendVerification(trace: ExecutionTrace, v: VerificationRecord): void {
  appendTraceEvent(trace, {
    type: 'verification',
    summary: v.summary,
    refId: v.id,
    data: { ok: v.ok, gapId: v.gapId },
  });
}

export function appendRisk(trace: ExecutionTrace, d: RiskDecision): void {
  appendTraceEvent(trace, {
    type: 'risk',
    summary: `${d.level} ${d.verdict}: ${d.reason}`,
    refId: d.id,
    data: d,
  });
}

export function appendGap(trace: ExecutionTrace, gap: GapResult): void {
  appendTraceEvent(trace, {
    type: 'gap',
    summary: gap.summary,
    refId: gap.id,
    data: gap,
  });
}
