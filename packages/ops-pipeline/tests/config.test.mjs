import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadOpsConfig,
  requireGitlab,
  requireMetricsUrl,
  requireRelease,
} from '../dist/config.js';

describe('loadOpsConfig', () => {
  it('loads defaults without requiring all fields', () => {
    const cfg = loadOpsConfig({});
    assert.equal(cfg.logProvider, 'kubectl');
    assert.equal(cfg.releaseProvider, 'http');
    assert.equal(cfg.gitlabUrl, undefined);
  });

  it('reads OPS_* vars', () => {
    const cfg = loadOpsConfig({
      OPS_GITLAB_URL: 'https://gitlab.example/',
      OPS_GITLAB_TOKEN: 't',
      OPS_GITLAB_PROJECT: 'group/proj',
      OPS_LOG_PROVIDER: 'loki',
      OPS_LOKI_URL: 'http://loki:3100',
      OPS_DOCKER_PASSWORD: 'secret',
    });
    assert.equal(cfg.logProvider, 'loki');
    assert.equal(cfg.lokiUrl, 'http://loki:3100');
    assert.equal(cfg.dockerPassword, 'secret');
    const g = requireGitlab(cfg);
    assert.equal(g.gitlabUrl, 'https://gitlab.example');
  });

  it('lazy-validates metrics/release', () => {
    const cfg = loadOpsConfig({});
    assert.throws(() => requireMetricsUrl(cfg), /OPS_METRICS_HTTP_URL/);
    assert.throws(() => requireRelease(cfg), /OPS_RELEASE_WEBHOOK_URL/);
  });
});
