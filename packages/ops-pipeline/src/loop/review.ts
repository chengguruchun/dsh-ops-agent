/**
 * Self-review stage before release.
 * Checklist: non-empty diff, no secret-like patterns, optional OPS_REVIEW_COMMAND.
 * Blockers prevent release (hard-stop in agentLoop).
 */

import type { ExecFn } from '../exec.js';
import { createCodingWorkspace } from '../stages/coding.js';

export type ReviewFinding = {
  severity: 'info' | 'warning' | 'blocker';
  code: string;
  message: string;
};

export type ReviewResult = {
  ok: boolean;
  findings: ReviewFinding[];
  blockers: ReviewFinding[];
  diffText: string;
  statusText: string;
  requestSummary: string;
};

export type SelfReviewOptions = {
  workspaceDir: string;
  exec: ExecFn;
  /** Extra shell command (lint/test). Exit != 0 → blocker. */
  reviewCommand?: string;
  /** Skip empty-diff check (e.g. docs-only intentional). Default false. */
  allowEmptyDiff?: boolean;
  /** Injectable secret patterns (RegExp source strings). */
  secretPatterns?: RegExp[];
};

const DEFAULT_SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][^'"]{8,}['"]/i,
  /(?:glpat-|ghp_|sk-|AKIA)[A-Za-z0-9_\-]{16,}/,
  /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/i,
];

export async function selfReview(opts: SelfReviewOptions): Promise<ReviewResult> {
  const findings: ReviewFinding[] = [];
  const ws = createCodingWorkspace(opts.exec, opts.workspaceDir);

  const status = await ws.status();
  const diff = await ws.diff({ staged: false });
  const staged = await ws.diff({ staged: true });
  const diffText = [diff.text, staged.text].filter(Boolean).join('\n');
  const statusText = status.text;

  const summaries = [status.requestSummary, diff.requestSummary, staged.requestSummary];

  if (!opts.allowEmptyDiff) {
    const porcelainDirty = statusText
      .split('\n')
      .some((line) => line && !line.startsWith('##') && line.trim().length > 0);
    const hasDiff = diffText.trim().length > 0;
    if (!hasDiff && !porcelainDirty) {
      findings.push({
        severity: 'blocker',
        code: 'empty_diff',
        message: 'No code changes detected (empty git diff/status) — refusing release',
      });
    }
  }

  const patterns = opts.secretPatterns ?? DEFAULT_SECRET_PATTERNS;
  for (const re of patterns) {
    if (re.test(diffText) || re.test(statusText)) {
      findings.push({
        severity: 'blocker',
        code: 'secret_pattern',
        message: `Potential secret matched pattern ${re.source.slice(0, 60)}… — hard-stop before release`,
      });
    }
  }

  const reviewCommand = opts.reviewCommand ?? process.env.OPS_REVIEW_COMMAND;
  if (reviewCommand && reviewCommand.trim()) {
    const result = await opts.exec({
      cmd: '/bin/sh',
      args: ['-c', reviewCommand],
      cwd: opts.workspaceDir,
    });
    summaries.push(`OPS_REVIEW_COMMAND exit=${result.code}`);
    if (result.code !== 0) {
      findings.push({
        severity: 'blocker',
        code: 'review_command_failed',
        message: `OPS_REVIEW_COMMAND failed (exit ${result.code}): ${(result.stderr || result.stdout).slice(0, 500)}`,
      });
    } else {
      findings.push({
        severity: 'info',
        code: 'review_command_ok',
        message: 'OPS_REVIEW_COMMAND passed',
      });
    }
  }

  const blockers = findings.filter((f) => f.severity === 'blocker');
  return {
    ok: blockers.length === 0,
    findings,
    blockers,
    diffText,
    statusText,
    requestSummary: summaries.join(' ; '),
  };
}
