import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeReviewConfig } from '../dist/config.js';
import { fetchPr } from '../dist/stages/fetchPr.js';
import { listChangedFiles } from '../dist/stages/listChangedFiles.js';
import { heuristicReview } from '../dist/stages/heuristicReview.js';
import { runStaticChecks } from '../dist/stages/runStaticChecks.js';
import { postReviewComment } from '../dist/stages/postReviewComment.js';

function recordingExec(handler) {
  const calls = [];
  const exec = async (req) => {
    calls.push({
      cmd: req.cmd,
      args: [...(req.args ?? [])],
      cwd: req.cwd,
      env: req.env,
      stdin: req.stdin,
    });
    return handler(req, calls);
  };
  exec.calls = calls;
  return exec;
}

describe('fetchPr / listChangedFiles (DI exec)', () => {
  it('gh pr view argv + token via env', async () => {
    const cfg = loadCodeReviewConfig({
      CR_PROVIDER: 'github',
      CR_REPO: 'acme/app',
      GH_TOKEN: 'tok',
    });
    const exec = recordingExec(async () => ({
      code: 0,
      stdout: JSON.stringify({
        number: 42,
        title: 'Fix crash',
        body: 'details',
        author: { login: 'dev' },
        url: 'https://github.com/acme/app/pull/42',
        baseRefName: 'main',
        headRefName: 'fix/crash',
        state: 'OPEN',
      }),
      stderr: '',
    }));
    const { pr, requestSummary } = await fetchPr(cfg, exec, { number: 42 });
    assert.equal(exec.calls[0].cmd, 'gh');
    assert.ok(exec.calls[0].args.includes('pr'));
    assert.ok(exec.calls[0].args.includes('view'));
    assert.ok(exec.calls[0].args.includes('42'));
    assert.ok(exec.calls[0].args.includes('--repo'));
    assert.equal(exec.calls[0].env.GH_TOKEN, 'tok');
    assert.ok(!JSON.stringify(exec.calls[0].args).includes('tok'));
    assert.equal(pr.title, 'Fix crash');
    assert.equal(pr.author, 'dev');
    assert.match(requestSummary, /gh pr view/);
  });

  it('glab mr view argv', async () => {
    const cfg = loadCodeReviewConfig({
      CR_PROVIDER: 'gitlab',
      GITLAB_TOKEN: 'glpat-x',
    });
    const exec = recordingExec(async () => ({
      code: 0,
      stdout: JSON.stringify({
        iid: 7,
        title: 'MR',
        description: 'body',
        author: { username: 'alice' },
        web_url: 'https://gitlab.example/g/p/-/merge_requests/7',
        source_branch: 'feat',
        target_branch: 'main',
        state: 'opened',
      }),
      stderr: '',
    }));
    const { pr } = await fetchPr(cfg, exec, { number: 7 });
    assert.equal(exec.calls[0].cmd, 'glab');
    assert.deepEqual(exec.calls[0].args.slice(0, 3), ['mr', 'view', '7']);
    assert.equal(pr.number, 7);
    assert.equal(pr.author, 'alice');
  });

  it('gh pr diff --name-only lists files', async () => {
    const cfg = loadCodeReviewConfig({ CR_PROVIDER: 'github', GH_TOKEN: 't' });
    const exec = recordingExec(async (req) => {
      if (req.args.includes('--name-only')) {
        return { code: 0, stdout: 'src/a.ts\nsrc/a.test.ts\n', stderr: '' };
      }
      return { code: 0, stdout: 'diff --git a/src/a.ts b/src/a.ts\n+line\n', stderr: '' };
    });
    const { files, diffText } = await listChangedFiles(cfg, exec, { number: 1 });
    assert.equal(files.length, 2);
    assert.equal(files[0].path, 'src/a.ts');
    assert.ok(diffText.includes('+line'));
  });
});

describe('heuristicReview', () => {
  const cfg = loadCodeReviewConfig({ CR_HUGE_DIFF_LINES: '50', CR_TODO_DENSITY: '3' });

  it('flags secrets as blockers', () => {
    const result = heuristicReview(cfg, {
      files: [{ path: 'src/x.ts' }],
      diffText: '+const token = "ghp_abcdefghijklmnopqrstuvwxyz012345"',
    });
    assert.equal(result.ok, false);
    assert.ok(result.blockers.some((b) => b.code === 'secret_pattern'));
  });

  it('flags missing tests and todo density', () => {
    const todos = Array.from({ length: 5 }, () => '+// TODO fix later').join('\n');
    const result = heuristicReview(cfg, {
      files: [{ path: 'src/service.ts' }],
      diffText: `${todos}\n`,
    });
    assert.ok(result.findings.some((f) => f.code === 'missing_tests'));
    assert.ok(result.findings.some((f) => f.code === 'todo_density'));
  });

  it('flags huge diffs', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `+line ${i}`).join('\n');
    const result = heuristicReview(cfg, {
      files: [{ path: 'src/a.ts' }, { path: 'src/a.test.ts' }],
      diffText: lines,
    });
    assert.ok(result.findings.some((f) => f.code === 'huge_diff'));
  });
});

describe('runStaticChecks / postReviewComment', () => {
  it('skips when no command', async () => {
    const cfg = loadCodeReviewConfig({});
    const exec = recordingExec(async () => {
      throw new Error('should not run');
    });
    const r = await runStaticChecks(cfg, exec);
    assert.equal(r.skipped, true);
    assert.equal(r.ok, true);
  });

  it('runs CR_REVIEW_COMMAND via /bin/sh -c', async () => {
    const cfg = loadCodeReviewConfig({ CR_REVIEW_COMMAND: 'npm test' });
    const exec = recordingExec(async () => ({ code: 0, stdout: 'ok', stderr: '' }));
    const r = await runStaticChecks(cfg, exec, { cwd: '/tmp/ws' });
    assert.equal(r.skipped, false);
    assert.equal(r.ok, true);
    assert.equal(exec.calls[0].cmd, '/bin/sh');
    assert.deepEqual(exec.calls[0].args, ['-c', 'npm test']);
    assert.equal(exec.calls[0].cwd, '/tmp/ws');
  });

  it('gh pr comment argv keeps body on args, token in env', async () => {
    const cfg = loadCodeReviewConfig({ GH_TOKEN: 'tok' });
    const exec = recordingExec(async () => ({
      code: 0,
      stdout: 'https://github.com/acme/app/pull/1#issuecomment-1\n',
      stderr: '',
    }));
    await postReviewComment(cfg, exec, { number: 1, body: 'LGTM with notes' });
    assert.equal(exec.calls[0].cmd, 'gh');
    assert.ok(exec.calls[0].args.includes('comment'));
    assert.ok(exec.calls[0].args.includes('LGTM with notes'));
    assert.equal(exec.calls[0].env.GH_TOKEN, 'tok');
  });
});
