import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAlert } from '../dist/stages/alert.js';

describe('normalizeAlert', () => {
  it('parses Alertmanager webhook (first alert)', () => {
    const n = normalizeAlert({
      status: 'firing',
      alerts: [
        {
          status: 'firing',
          fingerprint: 'fp1',
          labels: {
            alertname: 'HighErrorRate',
            severity: 'critical',
            service: 'checkout',
            namespace: 'prod',
            pod: 'checkout-abc',
          },
          annotations: {
            summary: 'error rate high',
            description: 'p99 errors > 5%',
          },
          startsAt: '2026-09-21T01:00:00Z',
        },
      ],
    });
    assert.equal(n.name, 'HighErrorRate');
    assert.equal(n.severity, 'critical');
    assert.equal(n.status, 'firing');
    assert.equal(n.service, 'checkout');
    assert.equal(n.namespace, 'prod');
    assert.equal(n.pod, 'checkout-abc');
    assert.equal(n.fingerprint, 'fp1');
    assert.match(n.summary, /error rate/i);
  });

  it('parses single alert-shaped object', () => {
    const n = normalizeAlert({
      labels: { alertname: 'PodCrashLoop', severity: 'warning', app: 'api' },
      annotations: { summary: 'crash loop' },
      status: 'firing',
    });
    assert.equal(n.name, 'PodCrashLoop');
    assert.equal(n.severity, 'warning');
    assert.equal(n.service, 'api');
  });

  it('rejects unknown shapes', () => {
    assert.throws(() => normalizeAlert({ foo: 1 }), /unrecognized/i);
  });
});
