import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGitlabClient } from '../dist/stages/gitlab.js';
import { loadOpsConfig } from '../dist/config.js';

describe('GitLab client (fake fetch)', () => {
  const cfg = loadOpsConfig({
    OPS_GITLAB_URL: 'https://gitlab.example',
    OPS_GITLAB_TOKEN: 'glpat-test',
    OPS_GITLAB_PROJECT: 'group/app',
  });

  it('sends PRIVATE-TOKEN and encodes project path', async () => {
    const calls = [];
    const fetchFn = async (url, init = {}) => {
      calls.push({
        url: String(url),
        method: init.method ?? 'GET',
        headers: init.headers,
        body: init.body,
      });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ id: 1, path_with_namespace: 'group/app' });
        },
      };
    };
    const gl = createGitlabClient(cfg, fetchFn);
    await gl.getProject();
    assert.equal(calls[0].headers['PRIVATE-TOKEN'], 'glpat-test');
    assert.match(calls[0].url, /\/api\/v4\/projects\/group%2Fapp$/);

    await gl.createIssue({ title: 't', description: 'd', labels: ['ops'] });
    assert.equal(calls[1].method, 'POST');
    assert.match(calls[1].url, /\/issues$/);
    assert.equal(JSON.parse(calls[1].body).title, 't');

    await gl.searchCode('NullPointer');
    assert.match(calls[2].url, /scope=blobs/);
    assert.match(calls[2].url, /search=NullPointer/);

    await gl.createMergeRequest({
      sourceBranch: 'fix/a',
      targetBranch: 'main',
      title: 'fix',
    });
    const body = JSON.parse(calls[3].body);
    assert.equal(body.source_branch, 'fix/a');
    assert.equal(body.target_branch, 'main');
  });
});
