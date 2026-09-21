import type { CodeReviewConfig } from '../config.js';
import type { ExecFn } from '../exec.js';

export type StaticCheckResult = {
  ok: boolean;
  skipped: boolean;
  command?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  requestSummary: string;
};

export type RunStaticChecksOpts = {
  cwd?: string;
  /** Override CR_REVIEW_COMMAND. */
  reviewCommand?: string;
};

export async function runStaticChecks(
  cfg: CodeReviewConfig,
  exec: ExecFn,
  opts: RunStaticChecksOpts = {},
): Promise<StaticCheckResult> {
  const command = (opts.reviewCommand ?? cfg.reviewCommand)?.trim();
  if (!command) {
    return {
      ok: true,
      skipped: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      requestSummary: 'skipped: CR_REVIEW_COMMAND not set',
    };
  }
  const result = await exec({
    cmd: '/bin/sh',
    args: ['-c', command],
    cwd: opts.cwd,
  });
  return {
    ok: result.code === 0,
    skipped: false,
    command,
    exitCode: result.code,
    stdout: result.stdout.slice(0, 20_000),
    stderr: result.stderr.slice(0, 20_000),
    requestSummary: `CR_REVIEW_COMMAND exit=${result.code}`,
  };
}
