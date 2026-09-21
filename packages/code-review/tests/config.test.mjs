import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeReviewConfig, forgeCliEnv } from '../dist/config.js';

describe('loadCodeReviewConfig', () => {
  it('defaults to github provider', () => {
    const cfg = loadCodeReviewConfig({});
    assert.equal(cfg.provider, 'github');
    assert.equal(cfg.enablePublish, false);
    assert.equal(cfg.hugeDiffLines, 800);
  });

  it('reads GH_TOKEN and CR_* overrides', () => {
    const cfg = loadCodeReviewConfig({
      CR_PROVIDER: 'gitlab',
      CR_REPO: 'group/proj',
      GITLAB_TOKEN: 'glpat-xxx',
      CR_REVIEW_COMMAND: 'npm test',
      CR_PUBLISH: 'true',
      CR_HUGE_DIFF_LINES: '100',
    });
    assert.equal(cfg.provider, 'gitlab');
    assert.equal(cfg.repo, 'group/proj');
    assert.equal(cfg.gitlabToken, 'glpat-xxx');
    assert.equal(cfg.reviewCommand, 'npm test');
    assert.equal(cfg.enablePublish, true);
    assert.equal(cfg.hugeDiffLines, 100);
  });

  it('prefers CR_GH_TOKEN over GH_TOKEN', () => {
    const cfg = loadCodeReviewConfig({
      GH_TOKEN: 'a',
      CR_GH_TOKEN: 'b',
    });
    assert.equal(cfg.githubToken, 'b');
  });

  it('rejects bad provider', () => {
    assert.throws(() => loadCodeReviewConfig({ CR_PROVIDER: 'bitbucket' }), /CR_PROVIDER/);
  });

  it('forgeCliEnv puts tokens in env not argv surface', () => {
    const env = forgeCliEnv(
      loadCodeReviewConfig({ GH_TOKEN: 'secret-token', CR_PROVIDER: 'github' }),
    );
    assert.equal(env.GH_TOKEN, 'secret-token');
  });
});
