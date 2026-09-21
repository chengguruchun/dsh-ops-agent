import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ExecFn } from '../exec.js';
import { assertOk } from '../exec.js';

export type CodingWorkspace = {
  root: string;
  cloneOrFetch: (repoUrl: string, opts?: { branch?: string }) => Promise<{ requestSummary: string }>;
  createBranch: (branch: string, fromRef?: string) => Promise<{ requestSummary: string }>;
  applyPatchFile: (patchFile: string) => Promise<{ requestSummary: string; stdout: string }>;
  commitAll: (message: string) => Promise<{ requestSummary: string }>;
  status: () => Promise<{ text: string; requestSummary: string }>;
  diff: (opts?: { staged?: boolean }) => Promise<{ text: string; requestSummary: string }>;
};

/** Real git helpers. No LLM — DSH/Pi supplies the patch content. */
export function createCodingWorkspace(exec: ExecFn, root: string): CodingWorkspace {
  const abs = path.resolve(root);

  async function git(args: string[], label: string) {
    const result = await exec({ cmd: 'git', args, cwd: abs });
    assertOk(result, label);
    return result;
  }

  return {
    root: abs,
    async cloneOrFetch(repoUrl, opts = {}) {
      await mkdir(abs, { recursive: true });
      const probe = await exec({
        cmd: 'git',
        args: ['rev-parse', '--is-inside-work-tree'],
        cwd: abs,
      });
      if (probe.code === 0 && probe.stdout.trim() === 'true') {
        await git(['fetch', '--all', '--prune'], 'git fetch');
        if (opts.branch) {
          await git(['checkout', opts.branch], 'git checkout');
          await git(['pull', '--ff-only', 'origin', opts.branch], 'git pull');
        }
        return { requestSummary: `git fetch in ${abs}` };
      }
      const cloneArgs = ['clone'];
      if (opts.branch) cloneArgs.push('-b', opts.branch);
      cloneArgs.push(repoUrl, '.');
      const result = await exec({ cmd: 'git', args: cloneArgs, cwd: abs });
      assertOk(result, 'git clone');
      return { requestSummary: `git ${cloneArgs.join(' ')} (cwd=${abs})` };
    },
    async createBranch(branch, fromRef = 'HEAD') {
      await git(['checkout', '-B', branch, fromRef], 'git checkout -B');
      return { requestSummary: `git checkout -B ${branch} ${fromRef}` };
    },
    async applyPatchFile(patchFile) {
      const result = await git(['apply', '--index', patchFile], 'git apply');
      return { requestSummary: `git apply --index ${patchFile}`, stdout: result.stdout };
    },
    async commitAll(message) {
      await git(['add', '-A'], 'git add');
      await git(['commit', '-m', message], 'git commit');
      return { requestSummary: `git commit -m ${JSON.stringify(message)}` };
    },
    async status() {
      const result = await git(['status', '--porcelain=v1', '-b'], 'git status');
      return { text: result.stdout, requestSummary: 'git status --porcelain=v1 -b' };
    },
    async diff(opts = {}) {
      const args = opts.staged ? ['diff', '--cached'] : ['diff'];
      const result = await git(args, 'git diff');
      return { text: result.stdout, requestSummary: `git ${args.join(' ')}` };
    },
  };
}
