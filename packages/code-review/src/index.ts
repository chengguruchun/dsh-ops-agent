export {
  loadCodeReviewConfig,
  requireGithubAuth,
  requireGitlabAuth,
  forgeCliEnv,
  type CodeReviewConfig,
  type CrProvider,
} from './config.js';

export {
  createProcessExec,
  assertOk,
  type ExecFn,
  type ExecRequest,
  type ExecResult,
} from './exec.js';

export { fetchPr, type PullRequestRef, type FetchPrOpts } from './stages/fetchPr.js';
export {
  listChangedFiles,
  type ChangedFile,
  type ListChangedFilesOpts,
} from './stages/listChangedFiles.js';
export {
  runStaticChecks,
  type StaticCheckResult,
  type RunStaticChecksOpts,
} from './stages/runStaticChecks.js';
export {
  heuristicReview,
  type HeuristicFinding,
  type HeuristicReviewResult,
  type HeuristicReviewInput,
} from './stages/heuristicReview.js';
export {
  postReviewComment,
  type PostReviewCommentOpts,
  type PostReviewCommentResult,
} from './stages/postReviewComment.js';

export {
  runCodeReviewLoop,
  loadCodeReviewCheckpoint,
  type CodeReviewPhase,
  type CodeReviewLoopOptions,
  type CodeReviewLoopResult,
  type CodeReviewSummary,
} from './loop/codeReviewLoop.js';

export {
  CR_TOOL_CATALOG,
  listCrToolNames,
  type CrToolDescriptor,
} from './tools/catalog.js';
