export {
  registerOpsTools,
  expectedOpsToolNames,
  expectedCrToolNames,
  expectedAllToolNames,
  type RegisterOpsToolsResult,
} from './register.js';

export {
  createRuntime,
  type OpsToolRuntime,
  type RegisterOpsToolsOptions,
  type FetchFn,
} from './deps.js';

export { invokeOpsTool, OPS_TOOL_HANDLERS, type OpsToolHandler } from './handlers.js';
export { invokeCrTool, CR_TOOL_HANDLERS, type CrToolHandler } from './handlers-cr.js';

export { registerCompactionGuard } from './compaction.js';

export {
  toolTextResult,
  toolErrorResult,
  type PiExtensionAPI,
  type PiToolDefinition,
  type PiToolResult,
} from './pi-abi.js';

export { default as dshOpsAgentExtension } from './extension.js';
