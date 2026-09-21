/* Runtime primitives V0.2–V0.5 */

export {
  classifyMutatingAction,
  evaluateRiskGate,
  assertRiskAllowed,
  isRiskDenied,
  policyForLevel,
  RiskGateDeniedError,
  RISK_DEFAULT_POLICY,
  type RiskLevel,
  type RiskPolicy,
  type RiskVerdict,
  type MutatingAction,
  type MutatingActionKind,
  type RiskDecision,
  type RiskGateOptions,
} from './riskGate.js';

export {
  makeObservation,
  makeEvidence,
  makeDecision,
  makeAction,
  makeResult,
  makeVerification,
  type Observation,
  type Evidence,
  type DecisionRecord,
  type ActionRecord,
  type ResultRecord,
  type VerificationRecord,
} from './evidence.js';

export {
  createExecutionTrace,
  appendTraceEvent,
  appendObservation,
  appendEvidence,
  appendDecision,
  appendAction,
  appendResult,
  appendVerification,
  appendRisk,
  appendGap,
  type ExecutionTrace,
  type TraceEvent,
  type TraceEventType,
} from './trace.js';

export {
  createAgentState,
  cloneAgentState,
  type AgentState,
} from './agentState.js';

export {
  computeGap,
  actualFromVerifyText,
  type ExpectedState,
  type ActualState,
  type GapItem,
  type GapResult,
  type ComputeGapOptions,
} from './gap.js';

export {
  InMemoryEventBus,
  type RuntimeEvent,
  type RuntimeEventHandler,
} from './eventBus.js';

export {
  DomainRegistry,
  createDefaultDomainRegistry,
  type DomainId,
  type DomainDescriptor,
} from './domainRegistry.js';

export { newRuntimeId, resetRuntimeIdSeqForTests, type IdKind } from './ids.js';
