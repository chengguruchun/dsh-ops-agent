/**
 * V0.3 Evidence model — Observation / Evidence / Decision / Action / Result / Verification
 */

import { newRuntimeId } from './ids.js';

export type Observation = {
  id: string;
  at: string;
  source: string;
  summary: string;
  data?: unknown;
};

export type Evidence = {
  id: string;
  at: string;
  observationIds: string[];
  kind: string;
  summary: string;
  data?: unknown;
};

export type DecisionRecord = {
  id: string;
  at: string;
  evidenceIds: string[];
  summary: string;
  choice: string;
  riskLevel?: string;
  data?: unknown;
};

export type ActionRecord = {
  id: string;
  at: string;
  decisionId?: string;
  kind: string;
  summary: string;
  riskLevel?: string;
  data?: unknown;
};

export type ResultRecord = {
  id: string;
  at: string;
  actionId: string;
  ok: boolean;
  summary: string;
  data?: unknown;
};

export type VerificationRecord = {
  id: string;
  at: string;
  resultIds: string[];
  ok: boolean;
  summary: string;
  gapId?: string;
  data?: unknown;
};

export function makeObservation(
  partial: Omit<Observation, 'id' | 'at'> & { id?: string; at?: string },
): Observation {
  return {
    id: partial.id ?? newRuntimeId('obs'),
    at: partial.at ?? new Date().toISOString(),
    source: partial.source,
    summary: partial.summary,
    data: partial.data,
  };
}

export function makeEvidence(
  partial: Omit<Evidence, 'id' | 'at'> & { id?: string; at?: string },
): Evidence {
  return {
    id: partial.id ?? newRuntimeId('ev'),
    at: partial.at ?? new Date().toISOString(),
    observationIds: partial.observationIds,
    kind: partial.kind,
    summary: partial.summary,
    data: partial.data,
  };
}

export function makeDecision(
  partial: Omit<DecisionRecord, 'id' | 'at'> & { id?: string; at?: string },
): DecisionRecord {
  return {
    id: partial.id ?? newRuntimeId('dec'),
    at: partial.at ?? new Date().toISOString(),
    evidenceIds: partial.evidenceIds,
    summary: partial.summary,
    choice: partial.choice,
    riskLevel: partial.riskLevel,
    data: partial.data,
  };
}

export function makeAction(
  partial: Omit<ActionRecord, 'id' | 'at'> & { id?: string; at?: string },
): ActionRecord {
  return {
    id: partial.id ?? newRuntimeId('act'),
    at: partial.at ?? new Date().toISOString(),
    decisionId: partial.decisionId,
    kind: partial.kind,
    summary: partial.summary,
    riskLevel: partial.riskLevel,
    data: partial.data,
  };
}

export function makeResult(
  partial: Omit<ResultRecord, 'id' | 'at'> & { id?: string; at?: string },
): ResultRecord {
  return {
    id: partial.id ?? newRuntimeId('res'),
    at: partial.at ?? new Date().toISOString(),
    actionId: partial.actionId,
    ok: partial.ok,
    summary: partial.summary,
    data: partial.data,
  };
}

export function makeVerification(
  partial: Omit<VerificationRecord, 'id' | 'at'> & { id?: string; at?: string },
): VerificationRecord {
  return {
    id: partial.id ?? newRuntimeId('ver'),
    at: partial.at ?? new Date().toISOString(),
    resultIds: partial.resultIds,
    ok: partial.ok,
    summary: partial.summary,
    gapId: partial.gapId,
    data: partial.data,
  };
}
