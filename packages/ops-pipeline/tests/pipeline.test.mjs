import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runOpsClosedLoop } from '../dist/pipeline.js';
import { listOpsToolNames } from '../dist/tools/catalog.js';
import { loadOpsConfig } from '../dist/config.js';

describe('runOpsClosedLoop', () => {
  it('normalizes alert and skips stages lacking config', async () => {
    const report = await runOpsClosedLoop({
      alert: {
        labels: { alertname: 'TestAlert', severity: 'info', service: 'svc' },
        annotations: { summary: 'hello' },
        status: 'firing',
      },
      config: loadOpsConfig({}),
      exec: async () => {
        throw new Error('exec should not be called when k8s/logs skipped');
      },
      skip: { k8s: true, logs: true },
    });
    assert.equal(report.alert?.name, 'TestAlert');
    const byName = Object.fromEntries(report.steps.map((s) => [s.name, s]));
    assert.equal(byName.alert.ok, true);
    assert.equal(byName.logs.skipped, true);
    assert.equal(byName.k8s.skipped, true);
    assert.equal(byName.metrics.skipped, true);
    assert.equal(byName.gitlab.skipped, true);
    assert.equal(report.ok, true);
  });
});

describe('tool catalog', () => {
  it('exposes closed-loop tool names', () => {
    const names = listOpsToolNames();
    assert.ok(names.includes('ops_normalize_alert'));
    assert.ok(names.includes('ops_run_closed_loop'));
    assert.ok(names.includes('ops_docker_build_push'));
  });
});
