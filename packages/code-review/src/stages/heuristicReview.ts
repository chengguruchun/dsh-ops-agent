import type { CodeReviewConfig } from '../config.js';
import type { ChangedFile } from './listChangedFiles.js';
import type { PullRequestRef } from './fetchPr.js';

export type HeuristicFinding = {
  severity: 'info' | 'warning' | 'blocker';
  code: string;
  message: string;
};

export type HeuristicReviewResult = {
  ok: boolean;
  findings: HeuristicFinding[];
  blockers: HeuristicFinding[];
  stats: {
    fileCount: number;
    diffLines: number;
    todoCount: number;
    testFileCount: number;
    productionFileCount: number;
  };
  requestSummary: string;
};

export type HeuristicReviewInput = {
  pr?: PullRequestRef;
  files: ChangedFile[];
  diffText?: string;
  /** Injectable secret patterns (RegExp). */
  secretPatterns?: RegExp[];
  hugeDiffLines?: number;
  todoDensityThreshold?: number;
};

const DEFAULT_SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][^'"]{8,}['"]/i,
  /(?:glpat-|ghp_|gho_|sk-|AKIA)[A-Za-z0-9_\-]{16,}/,
  /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/i,
];

function isTestPath(p: string): boolean {
  return (
    /(?:\.test\.|\.spec\.)/.test(p) ||
    /\/__tests__\//.test(p) ||
    /\/tests?\//.test(p) ||
    /\/spec\//.test(p)
  );
}

function isProductionCodePath(p: string): boolean {
  if (isTestPath(p)) return false;
  if (/\.(md|txt|json|ya?ml|toml|lock)$/i.test(p)) return false;
  if (/(^|\/)docs?\//i.test(p)) return false;
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift)$/i.test(p);
}

export function heuristicReview(
  cfg: CodeReviewConfig,
  input: HeuristicReviewInput,
): HeuristicReviewResult {
  const findings: HeuristicFinding[] = [];
  const files = input.files ?? [];
  const diffText = input.diffText ?? '';
  const body = input.pr?.body ?? '';
  const title = input.pr?.title ?? '';
  const corpus = [diffText, body, title].join('\n');

  const diffLines = diffText ? diffText.split('\n').length : 0;
  const todoMatches = corpus.match(/\b(TODO|FIXME|HACK|XXX)\b/gi) ?? [];
  const todoCount = todoMatches.length;
  const testFileCount = files.filter((f) => isTestPath(f.path)).length;
  const productionFileCount = files.filter((f) => isProductionCodePath(f.path)).length;

  const patterns = input.secretPatterns ?? DEFAULT_SECRET_PATTERNS;
  for (const re of patterns) {
    if (re.test(corpus)) {
      findings.push({
        severity: 'blocker',
        code: 'secret_pattern',
        message: `Potential secret matched /${re.source.slice(0, 48)}…/ in PR diff or description`,
      });
    }
  }

  const hugeLimit = input.hugeDiffLines ?? cfg.hugeDiffLines;
  if (diffLines >= hugeLimit) {
    findings.push({
      severity: 'warning',
      code: 'huge_diff',
      message: `Diff has ${diffLines} lines (threshold ${hugeLimit}) — consider splitting the PR`,
    });
  }

  if (productionFileCount > 0 && testFileCount === 0) {
    findings.push({
      severity: 'warning',
      code: 'missing_tests',
      message: `Changed ${productionFileCount} production file(s) with no test/spec paths in the diff`,
    });
  }

  const todoThreshold = input.todoDensityThreshold ?? cfg.todoDensityThreshold;
  if (todoCount >= todoThreshold) {
    findings.push({
      severity: 'warning',
      code: 'todo_density',
      message: `Found ${todoCount} TODO/FIXME/HACK/XXX markers (threshold ${todoThreshold})`,
    });
  }

  if (files.length === 0 && !diffText.trim()) {
    findings.push({
      severity: 'info',
      code: 'empty_change_set',
      message: 'No changed files / empty diff supplied to heuristic review',
    });
  }

  const blockers = findings.filter((f) => f.severity === 'blocker');
  return {
    ok: blockers.length === 0,
    findings,
    blockers,
    stats: {
      fileCount: files.length,
      diffLines,
      todoCount,
      testFileCount,
      productionFileCount,
    },
    requestSummary: `heuristicReview files=${files.length} diffLines=${diffLines} todos=${todoCount}`,
  };
}
