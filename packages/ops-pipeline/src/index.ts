export {
  loadOpsConfig,
  requireGitlab,
  requireMetricsUrl,
  requireRelease,
  kubectlEnv,
  kubectlContextArgs,
  type OpsConfig,
  type LogProvider,
  type ReleaseProvider,
} from './config.js';

export {
  createProcessExec,
  assertOk,
  type ExecFn,
  type ExecRequest,
  type ExecResult,
} from './exec.js';

export {
  normalizeAlert,
  type NormalizedAlert,
  type AlertSeverity,
} from './stages/alert.js';

export { queryLogs, type LogQuery, type LogQueryResult } from './stages/logs.js';
export { queryMetrics, type MetricsQuery, type MetricsResult } from './stages/metrics.js';
export {
  getPods,
  getEvents,
  describePod,
  getDeployments,
  rolloutStatus,
} from './stages/k8s.js';
export { createGitlabClient, type GitlabClient } from './stages/gitlab.js';
export { createCodingWorkspace, type CodingWorkspace } from './stages/coding.js';
export {
  buildAndPushImage,
  dockerLogin,
  dockerPull,
  type ImageBuildPushOpts,
  type ImageResult,
} from './stages/image.js';
export {
  helmUpgradeInstall,
  helmStatus,
  helmRollback,
  type HelmDeployOpts,
  type HelmDeployResult,
} from './stages/helm.js';
export {
  triggerRelease,
  type ReleasePayload,
  type ReleaseResult,
  type HelmReleaseOverrides,
} from './stages/release.js';
export { verifyRelease, type VerifyOpts, type VerifyResult } from './stages/verify.js';

export {
  runOpsClosedLoop,
  type OpsClosedLoopContext,
  type PipelineReport,
  type PipelineStepResult,
  type PipelineStepName,
  type PipelineSkip,
} from './pipeline.js';

export { OPS_TOOL_CATALOG, listOpsToolNames, type OpsToolDescriptor } from './tools/catalog.js';

/* ── AgentLoop + engineering resilience ── */
export { withRetry, isTransientError, type RetryOptions } from './loop/retry.js';
export {
  CircuitBreaker,
  CircuitOpenError,
  createBreakerRegistry,
  snapshotBreakers,
  restoreBreakers,
  type CircuitState,
  type CircuitBreakerOptions,
  type CircuitBreakerSnapshot,
  type BreakerRegistry,
} from './loop/circuitBreaker.js';
export {
  CheckpointStore,
  emptyReport,
  type CheckpointData,
  type CheckpointStoreOptions,
  type AgentLoopPhase,
  type AgentLoopReportSoFar,
} from './loop/checkpoint.js';
export {
  withFallbackChain,
  queryLogsWithFallback,
  queryMetricsSoft,
  triggerReleaseWithFallback,
  type FallbackAttempt,
  type FallbackResult,
} from './loop/degrade.js';
export { selfReview, type ReviewResult, type ReviewFinding, type SelfReviewOptions } from './loop/review.js';
export {
  discover,
  type DiscoveryReport,
  type DiscoveryHypothesis,
  type DiscoverOptions,
} from './loop/discover.js';
export {
  runAgentLoop,
  loadAgentLoopCheckpoint,
  type AgentLoopOptions,
  type AgentLoopResult,
} from './loop/agentLoop.js';
