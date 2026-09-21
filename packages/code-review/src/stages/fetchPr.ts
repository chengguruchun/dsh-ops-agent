import type { CodeReviewConfig } from '../config.js';
import { forgeCliEnv } from '../config.js';
import type { ExecFn } from '../exec.js';
import { assertOk } from '../exec.js';

export type PullRequestRef = {
  provider: 'github' | 'gitlab';
  number: number;
  title: string;
  body: string;
  author?: string;
  url?: string;
  baseRef?: string;
  headRef?: string;
  state?: string;
  raw?: unknown;
};

export type FetchPrOpts = {
  number: number;
  repo?: string;
  cwd?: string;
};

function parseJson(stdout: string, label: string): unknown {
  const text = stdout.trim();
  if (!text) throw new Error(`${label}: empty stdout`);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `${label}: invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function fetchPr(
  cfg: CodeReviewConfig,
  exec: ExecFn,
  opts: FetchPrOpts,
): Promise<{ pr: PullRequestRef; requestSummary: string }> {
  const repo = opts.repo ?? cfg.repo;
  const env = forgeCliEnv(cfg);

  if (cfg.provider === 'github') {
    const args = [
      'pr',
      'view',
      String(opts.number),
      '--json',
      'number,title,body,author,url,baseRefName,headRefName,state',
    ];
    if (repo) args.push('--repo', repo);
    const result = await exec({ cmd: 'gh', args, cwd: opts.cwd, env });
    assertOk(result, 'gh pr view');
    const raw = parseJson(result.stdout, 'gh pr view') as Record<string, unknown>;
    const authorObj = raw.author as Record<string, unknown> | undefined;
    const pr: PullRequestRef = {
      provider: 'github',
      number: Number(raw.number ?? opts.number),
      title: asString(raw.title) ?? '',
      body: asString(raw.body) ?? '',
      author: asString(authorObj?.login) ?? asString(raw.author),
      url: asString(raw.url),
      baseRef: asString(raw.baseRefName),
      headRef: asString(raw.headRefName),
      state: asString(raw.state),
      raw,
    };
    return {
      pr,
      requestSummary: `gh pr view ${opts.number}${repo ? ` --repo ${repo}` : ''}`,
    };
  }

  const args = ['mr', 'view', String(opts.number), '--output', 'json'];
  if (repo) args.push('--repo', repo);
  const result = await exec({ cmd: 'glab', args, cwd: opts.cwd, env });
  assertOk(result, 'glab mr view');
  const raw = parseJson(result.stdout, 'glab mr view') as Record<string, unknown>;
  const authorObj = raw.author as Record<string, unknown> | undefined;
  const pr: PullRequestRef = {
    provider: 'gitlab',
    number: Number(raw.iid ?? raw.id ?? opts.number),
    title: asString(raw.title) ?? '',
    body: asString(raw.description) ?? asString(raw.body) ?? '',
    author: asString(authorObj?.username) ?? asString(raw.author),
    url: asString(raw.web_url) ?? asString(raw.url),
    baseRef: asString(raw.target_branch) ?? asString(raw.targetBranch),
    headRef: asString(raw.source_branch) ?? asString(raw.sourceBranch),
    state: asString(raw.state),
    raw,
  };
  return {
    pr,
    requestSummary: `glab mr view ${opts.number}${repo ? ` --repo ${repo}` : ''}`,
  };
}
