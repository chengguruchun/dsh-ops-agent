import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeGap, actualFromVerifyText } from '../dist/runtime/gap.js';
import { runAgentLoop } from '../dist/loop/agentLoop.js';
import { loadOpsConfig } from '../dist/config.js';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('V0.4 Expected vs Actual Gap', () => {
  it('computeGap with DI actuals reports blockers + nextActionHint', async () => {
    const gap = await computeGap(
      {
        deployment: 'checkout',
        namespace: 'prod',
        imageRef: 'reg/checkout:2',
        rolloutComplete: true,
        readyReplicas: 3,
      },
      {
        actual: {
          deployment: 'checkout',
          namespace: 'prod',
          imageRef: 'reg/checkout:1',
          rolloutComplete: true,
          readyReplicas: 2,
        },
      },
    );
    assert.equal(gap.ok, false);
    assert.ok(gap.items.some((i) => i.field === 'imageRef'));
    assert.ok(gap.items.some((i) => i.field === 'readyReplicas'));
    assert.match(gap.nextActionHint ?? '', /re-release|imageRef/i);
  });

  it('actualFromVerifyText detects successful rollout', () => {
    const a = actualFromVerifyText('deployment "x" successfully rolled out\n');
    assert.equal(a.rolloutComplete, true);
  });

  it('AgentLoop verify fails closed on injected gap', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ops-gap-'));
    try {
      const result = await runAgentLoop({
        alert: {
          labels: { alertname: 'Z', severity: 'warning', service: 'api' },
          annotations: { summary: 'z' },
          status: 'firing',
        },
        config: loadOpsConfig({}),
        checkpointDir: dir,
        skip: { diagnose: true, fix: true, review: true, release: true },
        skipRiskGate: true,
        verify: { deployment: 'api', namespace: 'prod' },
        expectedState: { imageRef: 'want:2', rolloutComplete: true },
        injectedActualState: {
          deployment: 'api',
          namespace: 'prod',
          imageRef: 'want:1',
          rolloutComplete: false,
        },
        exec: async (req) => {
          const args = (req.args ?? []).join(' ');
          if (args.includes('rollout')) {
            return {
              code: 0,
              stdout: 'deployment "api" successfully rolled out\n',
              stderr: '',
            };
          }
          return { code: 0, stdout: '', stderr: '' };
        },
      });
      assert.equal(result.ok, false);
      assert.ok(result.gap);
      assert.equal(result.gap.ok, false);
      assert.ok(result.notes.some((n) => /gap after verify/i.test(n)));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
