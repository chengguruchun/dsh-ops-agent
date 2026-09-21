import type { CodeReviewConfig } from '../config.js';
import { forgeCliEnv } from '../config.js';
import type { ExecFn } from '../exec.js';
import { assertOk } from '../exec.js';

export type PostReviewCommentOpts = {
  number: number;
  body: string;
  repo?: string;
  cwd?: string;
};

export type PostReviewCommentResult = {
  ok: true;
  requestSummary: string;
  stdout: string;
};

export async function postReviewComment(
  cfg: CodeReviewConfig,
  exec: ExecFn,
  opts: PostReviewCommentOpts,
): Promise<PostReviewCommentResult> {
  if (!opts.body?.trim()) {
    throw new Error('postReviewComment requires non-empty body');
  }
  const repo = opts.repo ?? cfg.repo;
  const env = forgeCliEnv(cfg);

  if (cfg.provider === 'github') {
    const args = ['pr', 'comment', String(opts.number), '--body', opts.body];
    if (repo) args.push('--repo', repo);
    const result = await exec({ cmd: 'gh', args, cwd: opts.cwd, env });
    assertOk(result, 'gh pr comment');
    return {
      ok: true,
      requestSummary: `gh pr comment ${opts.number}${repo ? ` --repo ${repo}` : ''}`,
      stdout: result.stdout.trim(),
    };
  }

  const args = ['mr', 'note', String(opts.number), '--message', opts.body];
  if (repo) args.push('--repo', repo);
  const result = await exec({ cmd: 'glab', args, cwd: opts.cwd, env });
  assertOk(result, 'glab mr note');
  return {
    ok: true,
    requestSummary: `glab mr note ${opts.number}${repo ? ` --repo ${repo}` : ''}`,
    stdout: result.stdout.trim(),
  };
}
