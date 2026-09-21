import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMutatingAction,
  evaluateRiskGate,
  assertRiskAllowed,
  RiskGateDeniedError,
  RISK_DEFAULT_POLICY,
} from '../dist/runtime/riskGate.js';
import { runAgentLoop } from '../dist/loop/agentLoop.js';
import { loadOpsConfig } from '../dist/config.js';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('V0.2 Risk Gate', () => {
  it('classifies helm upgrade / kubectl delete / docker push', () => {
    assert.equal(classifyMutatingAction({ kind: 'x', command: 'helm upgrade app chart' }).level, 'L3');
    assert.equal(classifyMutatingAction({ kind: 'x', command: 'kubectl delete pod x' }).level, 'L4');
    assert.equal(classifyMutatingAction({ kind: 'x', command: 'docker push reg/app:1' }).level, 'L2');
    assert.equal(classifyMutatingAction({ kind: 'read_only' }).level, 'L0');
    assert.equal(RISK_DEFAULT_POLICY.L3, 'approval');
  });

  it('denies L4 human-only without unlock', () => {
    const d = evaluateRiskGate(
      { kind: 'kubectl_delete', command: 'kubectl delete ns prod' },
      { env: {} },
    );
    assert.equal(d.level, 'L4');
    assert.equal(d.verdict, 'deny');
    assert.throws(() => assertRiskAllowed(d), (e) => e instanceof RiskGateDeniedError);
  });

  it('L3 requires approval unless OPS_RISK_APPROVED', () => {
    const denied = evaluateRiskGate(
      { kind: 'helm_upgrade', command: 'helm upgrade a b' },
      { env: {} },
    );
    assert.equal(denied.verdict, 'require_approval');
    assert.throws(() => assertRiskAllowed(denied), RiskGateDeniedError);

    const ok = evaluateRiskGate(
      { kind: 'helm_upgrade', command: 'helm upgrade a b' },
      { env: { OPS_RISK_APPROVED: '1' } },
    );
    assert.equal(ok.verdict, 'allow_with_verify');
    assertRiskAllowed(ok);
  });

  it('AgentLoop hard-stops release when riskAction is L4', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ops-risk-l4-'));
    try {
      const result = await runAgentLoop({
        alert: {
          labels: { alertname: 'Y', severity: 'critical', service: 'pay' },
          annotations: { summary: 'down' },
          status: 'firing',
        },
        config: loadOpsConfig({
          OPS_RELEASE_PROVIDER: 'http',
          OPS_RELEASE_WEBHOOK_URL: 'https://example.invalid/hook',
        }),
        checkpointDir: dir,
        skip: { diagnose: true, fix: true },
        coding: { workspaceDir: dir },
        allowEmptyDiff: true,
        exec: async (req) => {
          const args = (req.args ?? []).join(' ');
          if (args.includes('status')) return { code: 0, stdout: '## main\n', stderr: '' };
          if (args.includes('diff')) {
            return { code: 0, stdout: 'diff --git a/x b/x\n+ok\n', stderr: '' };
          }
          return { code: 0, stdout: '', stderr: '' };
        },
        fetchFn: async () =>
          new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
        riskAction: { kind: 'kubectl_delete', command: 'kubectl delete ns prod' },
        skipRiskGate: false,
      });
      assert.equal(result.ok, false);
      assert.equal(result.phase, 'failed');
      assert.ok(result.riskDecision);
      assert.equal(result.riskDecision.level, 'L4');
      assert.equal(result.riskDecision.verdict, 'deny');
      assert.ok(result.notes.some((n) => /risk gate hard-stop/i.test(n)));
      assert.ok(result.agentState.riskDecisions.length >= 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('AgentLoop allows L3 release when riskApproved', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ops-risk-l3-'));
    try {
      const result = await runAgentLoop({
        alert: {
          labels: { alertname: 'Y2', severity: 'warning', service: 'pay' },
          annotations: { summary: 'down' },
          status: 'firing',
        },
        config: loadOpsConfig({
          OPS_RELEASE_PROVIDER: 'http',
          OPS_RELEASE_WEBHOOK_URL: 'https://example.invalid/hook',
        }),
        checkpointDir: dir,
        skip: { diagnose: true, fix: true, verify: true },
        coding: { workspaceDir: dir },
        allowEmptyDiff: true,
        exec: async (req) => {
          const args = (req.args ?? []).join(' ');
          if (args.includes('status')) return { code: 0, stdout: '## main\n', stderr: '' };
          if (args.includes('diff')) {
            return { code: 0, stdout: 'diff --git a/x b/x\n+ok\n', stderr: '' };
          }
          return { code: 0, stdout: '', stderr: '' };
        },
        fetchFn: async () =>
          new Response('released', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
        riskAction: { kind: 'helm_upgrade', command: 'helm upgrade app ./chart' },
        riskApproved: true,
      });
      assert.ok(result.riskDecision);
      assert.equal(result.riskDecision.level, 'L3');
      assert.notEqual(result.riskDecision.verdict, 'deny');
      assert.ok(result.report.phases.some((p) => p.name === 'release' && p.ok));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
