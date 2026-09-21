import type { CodeReviewConfig } from '../config.js';
import { forgeCliEnv } from '../config.js';
import type { ExecFn } from '../exec.js';
import { assertOk } from '../exec.js';

export type ChangedFile = {
  path: string;
  status?: string;
};

export type ListChangedFilesOpts = {
  number: number;
  repo?: string;
  cwd?: string;
};

function parseNameOnly(stdout: string): ChangedFile[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((path) => ({ path }));
}

/** Parse `git diff --name-status`-like lines: "M\tpath" or "A\tpath". */
function parseNameStatus(stdout: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const tab = t.indexOf('\t');
    if (tab > 0) {
      files.push({ status: t.slice(0, tab).trim(), path: t.slice(tab + 1).trim() });
    } else {
      const parts = t.split(/\s+/);
      if (parts.length >= 2) {
        files.push({ status: parts[0], path: parts.slice(1).join(' ') });
      } else {
        files.push({ path: t });
      }
    }
  }
  return files;
}

export async function listChangedFiles(
  cfg: CodeReviewConfig,
  exec: ExecFn,
  opts: ListChangedFilesOpts,
): Promise<{ files: ChangedFile[]; requestSummary: string; diffText?: string }> {
  const repo = opts.repo ?? cfg.repo;
  const env = forgeCliEnv(cfg);

  if (cfg.provider === 'github') {
    const nameArgs = ['pr', 'diff', String(opts.number), '--name-only'];
    if (repo) nameArgs.push('--repo', repo);
    const nameResult = await exec({ cmd: 'gh', args: nameArgs, cwd: opts.cwd, env });
    assertOk(nameResult, 'gh pr diff --name-only');
    const files = parseNameOnly(nameResult.stdout);

    const diffArgs = ['pr', 'diff', String(opts.number)];
    if (repo) diffArgs.push('--repo', repo);
    const diffResult = await exec({ cmd: 'gh', args: diffArgs, cwd: opts.cwd, env });
    // Diff may be large; soft-fail if name-only succeeded.
    const diffText = diffResult.code === 0 ? diffResult.stdout : undefined;
    return {
      files,
      diffText,
      requestSummary: `gh pr diff ${opts.number} --name-only${repo ? ` --repo ${repo}` : ''}`,
    };
  }

  // glab: prefer `glab mr diff <iid>` then fall back to name-status parsing.
  const args = ['mr', 'diff', String(opts.number)];
  if (repo) args.push('--repo', repo);
  const result = await exec({ cmd: 'glab', args, cwd: opts.cwd, env });
  assertOk(result, 'glab mr diff');
  const diffText = result.stdout;
  // Extract paths from unified diff headers.
  const files: ChangedFile[] = [];
  const seen = new Set<string>();
  for (const line of diffText.split('\n')) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (m) {
      const path = m[2] ?? m[1];
      if (path && !seen.has(path)) {
        seen.add(path);
        files.push({ path });
      }
    }
  }
  if (files.length === 0) {
    // Some glab versions support --name-only; try soft.
    const nameArgs = ['mr', 'diff', String(opts.number), '--name-only'];
    if (repo) nameArgs.push('--repo', repo);
    const nameResult = await exec({ cmd: 'glab', args: nameArgs, cwd: opts.cwd, env });
    if (nameResult.code === 0) {
      return {
        files: parseNameStatus(nameResult.stdout).length
          ? parseNameStatus(nameResult.stdout)
          : parseNameOnly(nameResult.stdout),
        diffText,
        requestSummary: `glab mr diff ${opts.number} --name-only`,
      };
    }
  }
  return {
    files,
    diffText,
    requestSummary: `glab mr diff ${opts.number}${repo ? ` --repo ${repo}` : ''}`,
  };
}
