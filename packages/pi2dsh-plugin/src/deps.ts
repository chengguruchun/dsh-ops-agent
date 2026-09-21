import {
  createProcessExec,
  loadOpsConfig,
  type ExecFn,
  type OpsConfig,
} from '@dsh-ops-agent/ops-pipeline';
import {
  loadCodeReviewConfig,
  type CodeReviewConfig,
} from '@dsh-ops-agent/code-review';

export type FetchFn = typeof fetch;

export type OpsToolRuntime = {
  getConfig: () => OpsConfig;
  getCrConfig: () => CodeReviewConfig;
  exec: ExecFn;
  fetchFn: FetchFn;
  /** Optional preserve hints for compaction-guard (incident-id, alert-rule, …). */
  getPreserveHints: () => readonly string[];
  /** Soft token floor used when mapping Pi compact events → CompactionContext. */
  pressureFloor: number;
};

export type RegisterOpsToolsOptions = {
  config?: OpsConfig | (() => OpsConfig);
  crConfig?: CodeReviewConfig | (() => CodeReviewConfig);
  exec?: ExecFn;
  fetchFn?: FetchFn;
  preserveHints?: readonly string[] | (() => readonly string[]);
  pressureFloor?: number;
  /** Register session_before_compact → compaction-guard. Default true. */
  enableCompactionGuard?: boolean;
  /** Register CR_TOOL_CATALOG alongside OPS. Default true. */
  enableCodeReview?: boolean;
};

export function createRuntime(options: RegisterOpsToolsOptions = {}): OpsToolRuntime {
  const getConfig = (): OpsConfig => {
    if (typeof options.config === 'function') return options.config();
    if (options.config) return options.config;
    return loadOpsConfig();
  };
  const getCrConfig = (): CodeReviewConfig => {
    if (typeof options.crConfig === 'function') return options.crConfig();
    if (options.crConfig) return options.crConfig;
    return loadCodeReviewConfig();
  };
  const getPreserveHints = (): readonly string[] => {
    if (typeof options.preserveHints === 'function') return options.preserveHints();
    return options.preserveHints ?? [];
  };
  return {
    getConfig,
    getCrConfig,
    exec: options.exec ?? createProcessExec(),
    fetchFn: options.fetchFn ?? fetch,
    getPreserveHints,
    pressureFloor: options.pressureFloor ?? 80_000,
  };
}
