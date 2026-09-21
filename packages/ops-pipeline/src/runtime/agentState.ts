/**
 * V0.3 / V0.5 rich AgentState stored inside checkpoints.
 */

import type { AgentLoopPhase } from '../loop/checkpoint.js';
import type {
  ActionRecord,
  DecisionRecord,
  Evidence,
  Observation,
  ResultRecord,
  VerificationRecord,
} from './evidence.js';
import type { RiskDecision } from './riskGate.js';
import type { ExecutionTrace } from './trace.js';
import type { GapResult } from './gap.js';

export type AgentState = {
  goal?: string;
  domain?: string;
  phase: AgentLoopPhase;
  paused?: boolean;
  pauseReason?: string;
  observations: Observation[];
  evidence: Evidence[];
  decisions: DecisionRecord[];
  actions: ActionRecord[];
  results: ResultRecord[];
  verifications: VerificationRecord[];
  riskDecisions: RiskDecision[];
  lastRisk?: RiskDecision;
  lastGap?: GapResult;
  trace?: ExecutionTrace;
  notes?: string[];
};

export function createAgentState(
  partial: Partial<AgentState> & { phase?: AgentLoopPhase } = {},
): AgentState {
  return {
    goal: partial.goal,
    domain: partial.domain ?? 'ops',
    phase: partial.phase ?? 'init',
    paused: partial.paused ?? false,
    pauseReason: partial.pauseReason,
    observations: partial.observations ? [...partial.observations] : [],
    evidence: partial.evidence ? [...partial.evidence] : [],
    decisions: partial.decisions ? [...partial.decisions] : [],
    actions: partial.actions ? [...partial.actions] : [],
    results: partial.results ? [...partial.results] : [],
    verifications: partial.verifications ? [...partial.verifications] : [],
    riskDecisions: partial.riskDecisions ? [...partial.riskDecisions] : [],
    lastRisk: partial.lastRisk,
    lastGap: partial.lastGap,
    trace: partial.trace,
    notes: partial.notes ? [...partial.notes] : [],
  };
}

export function cloneAgentState(state: AgentState): AgentState {
  return structuredClone(state);
}
