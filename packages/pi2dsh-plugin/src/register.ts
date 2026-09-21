import { OPS_TOOL_CATALOG, listOpsToolNames } from '@dsh-ops-agent/ops-pipeline';
import { CR_TOOL_CATALOG, listCrToolNames } from '@dsh-ops-agent/code-review';
import { createRuntime, type RegisterOpsToolsOptions } from './deps.js';
import { registerCompactionGuard } from './compaction.js';
import { invokeOpsTool } from './handlers.js';
import { invokeCrTool } from './handlers-cr.js';
import type { PiExtensionAPI, PiToolDefinition } from './pi-abi.js';
import { descriptorToTypeBox, toolLabel } from './schema.js';

export type RegisterOpsToolsResult = {
  toolNames: string[];
  opsToolNames: string[];
  crToolNames: string[];
  compactionGuard: boolean;
  codeReview: boolean;
};

/**
 * Register OPS_TOOL_CATALOG (+ optional CR_TOOL_CATALOG) on a Pi ExtensionAPI.
 * Handlers load config from env (or injected) and call real stages / loops.
 */
export function registerOpsTools(
  pi: PiExtensionAPI,
  options: RegisterOpsToolsOptions = {},
): RegisterOpsToolsResult {
  const runtime = createRuntime(options);
  const opsToolNames: string[] = [];
  const crToolNames: string[] = [];

  for (const descriptor of OPS_TOOL_CATALOG) {
    const name = descriptor.name;
    const definition: PiToolDefinition = {
      name,
      label: toolLabel(name),
      description: descriptor.description,
      parameters: descriptorToTypeBox(descriptor),
      promptSnippet: descriptor.description,
      async execute(_toolCallId, params) {
        return invokeOpsTool(name, params ?? {}, runtime);
      },
    };
    pi.registerTool(definition);
    opsToolNames.push(name);
  }

  const enableCodeReview = options.enableCodeReview !== false;
  if (enableCodeReview) {
    for (const descriptor of CR_TOOL_CATALOG) {
      const name = descriptor.name;
      const definition: PiToolDefinition = {
        name,
        label: toolLabel(name),
        description: descriptor.description,
        parameters: descriptorToTypeBox(descriptor),
        promptSnippet: descriptor.description,
        async execute(_toolCallId, params) {
          return invokeCrTool(name, params ?? {}, runtime);
        },
      };
      pi.registerTool(definition);
      crToolNames.push(name);
    }
  }

  const enableGuard = options.enableCompactionGuard !== false;
  if (enableGuard) {
    registerCompactionGuard(pi, runtime);
  }

  return {
    toolNames: [...opsToolNames, ...crToolNames],
    opsToolNames,
    crToolNames,
    compactionGuard: enableGuard,
    codeReview: enableCodeReview,
  };
}

/** Expected catalog names — useful for tests / diagnostics. */
export function expectedOpsToolNames(): string[] {
  return listOpsToolNames();
}

export function expectedCrToolNames(): string[] {
  return listCrToolNames();
}

export function expectedAllToolNames(): string[] {
  return [...listOpsToolNames(), ...listCrToolNames()];
}
