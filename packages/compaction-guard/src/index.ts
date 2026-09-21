export type {
  CompactionContext,
  CompactionDecision,
  CompactionGuard,
  CompactionPlan,
  CompactionTrigger,
} from './types.js';

export { replaceWhenPreserving, runCompactionGuards, vetoNearFloor } from './decide.js';

export {
  CODE_AGENT_HINTS,
  codeAgentPreservePlan,
  vetoWhileEditing,
  type CodeAgentHint,
} from './codeAgent.js';

export {
  OPS_AGENT_HINTS,
  defaultOpsAgentGuards,
  opsAgentPreservePlan,
  vetoWhileInvestigating,
  type OpsAgentHint,
} from './opsAgent.js';
