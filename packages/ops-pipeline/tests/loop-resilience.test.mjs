import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { withRetry } from '../dist/loop/retry.js';
import { CircuitBreaker, CircuitOpenError } from '../dist/loop/circuitBreaker.js';
import { CheckpointStore } from '../dist/loop/checkpoint.js';
import { selfReview } from '../dist/loop/review.js';
import { discover } from '../dist/loop/discover.js';
import { runAgentLoop } from '../dist/loop/agentLoop.js';
import { loadOpsConfig } from '../dist/config.js';
import { listOpsToolNames } from '../dist/tools/catalog.js';
import { queryLogsWithFallback } from '../dist/loop/degrade.js';

describe('withRetry', () => {
  it('succeeds after transient failures', async () => {
    let n = 0;
    const delays = [];
    const result = await withRetry(
      async () => {
        n += 1;
        if (n < 3) throw new Error('HTTP 503 unavailable');
        return 'ok';
      },
      {
        retries: 5,
        minDelayMs: 10,
        maxDelayMs: 100,
        jitter: false,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );
    assert.equal(result, 'ok');
    assert.equal(n, 3);
    assert.ok(delays.length >= 2);
  });

  it('does not retry when shouldRetry returns false', async () => {
    let n = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            n += 1;
            throw new Error('permanent');
          },
          {
            retries: 5,
            minDelayMs: 1,
            maxDelayMs: 1,
            jitter: false,
            shouldRetry: () => false,
            sleep: async () => {},
          },
        ),
      /permanent/,
    );
    assert.equal(n, 1);
  });
});

describe('CircuitBreaker', () => {
  it('opens after failureThreshold and fail-fasts during cooldown', async () => {
    let now = 1_000;
    const b = new CircuitBreaker({
      name: 'gitlab',
      failureThreshold: 2,
      cooldownMs: 1000,
      now: () => now,
    });

    await assert.rejects(() => b.exec(async () => { throw new Error('boom'); }), /boom/);
    await assert.rejects(() => b.exec(async () => { throw new Error('boom'); }), /boom/);
    assert.equal(b.getState(), 'open');

    await assert.rejects(() => b.exec(async () => 'x'), (err) => err instanceof CircuitOpenError);

    now += 1001;
    assert.equal(b.getState(), 'half-open');
    const v = await b.exec(async () => 'recovered');
    assert.equal(v, 'recovered');
    assert.equal(b.getState(), 'closed');
  });
});

describe('CheckpointStore', () => {
  it('write/read resume', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ops-cp-'));
    try {
      const store = new CheckpointStore({ dir });
      const file = await store.save({
        runId: 'run-abc',
        phase: 'diagnose',
        startedAt: '2026-09-21T00:00:00.000Z',
        updatedAt: '2026-09-21T00:00:00.000Z',
        report: { ok: true, phases: [{ name: 'discover', ok: true }] },
        attemptCounts: { discover: 1 },
        breakerStates: [],
      });
      assert.match(file, /run-abc\.json$/);
      const loaded = await store.load('run-abc');
      assert.equal(loaded.phase, 'diagnose');
      assert.equal(loaded.report.phases[0].name, 'discover');
      assert.equal(loaded.attemptCounts.discover, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('selfReview', () => {
  it('blocks on secret-like diff', async () => {
    const exec = async (req) => {
      const args = (req.args ?? []).join(' ');
      if (args.includes('status')) {
        return { code: 0, stdout: '## fix/ops\n M src/app.ts\n', stderr: '' };
      }
      if (args.includes('diff')) {
        return {
          code: 0,
          stdout: `diff --git a/src/app.ts b/src/app.ts
+const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
`,
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const result = await selfReview({ workspaceDir: '/tmp/ws-review', exec });
    assert.equal(result.ok, false);
    assert.ok(result.blockers.some((b) => b.code === 'secret_pattern'));
  });

  it('blocks on empty diff', async () => {
    const exec = async (req) => {
      const args = (req.args ?? []).join(' ');
      if (args.includes('status')) {
        return { code: 0, stdout: '## main\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const result = await selfReview({ workspaceDir: '/tmp/ws-empty', exec });
    assert.equal(result.ok, false);
    assert.ok(result.blockers.some((b) => b.code === 'empty_diff'));
  });
});

describe('discover', () => {
  it('builds report from injected data', async () => {
    const report = await discover({
      alert: {
        labels: {
          alertname: 'PodCrashLoop',
          severity: 'critical',
          service: 'checkout',
          namespace: 'prod',
        },
        annotations: { summary: 'CrashLoopBackOff on checkout', description: 'FATAL exception' },
        status: 'firing',
      },
      config: loadOpsConfig({}),
      exec: async () => {
        throw new Error('exec should not be called when injected');
      },
      injectedLogsText: 'ERROR Exception in thread main\nFATAL panic: nil\n',
      injectedPods: {
        items: [
          {
            metadata: { name: 'checkout-1' },
            status: {
              phase: 'Running',
              containerStatuses: [
                { restartCount: 8, state: { waiting: { reason: 'CrashLoopBackOff' } } },
              ],
            },
          },
        ],
      },
      injectedEvents: {
        items: [{ type: 'Warning', reason: 'BackOff', message: 'Back-off restarting failed container' }],
      },
    });
    assert.equal(report.suspectService, 'checkout');
    assert.ok(report.errorSignatures.length > 0);
    assert.ok(report.hypotheses.some((h) => h.id === 'crash' || h.id === 'k8s-unhealthy'));
    assert.ok(report.k8s.unhealthyPods.includes('checkout-1'));
  });
});

describe('queryLogsWithFallback', () => {
  it('falls back to kubectl when primary loki fails', async () => {
    const cfg = loadOpsConfig({
      OPS_LOG_PROVIDER: 'loki',
      OPS_LOKI_URL: 'http://loki.invalid:3100',
    });
    const calls = [];
    const exec = async (req) => {
      calls.push(req);
      return { code: 0, stdout: 'kubectl-log-line\n', stderr: '' };
    };
    const fetchFn = async () => {
      throw new Error('Loki down');
    };
    const result = await queryLogsWithFallback(
      cfg,
      exec,
      { service: 'api', namespace: 'prod' },
      fetchFn,
    );
    assert.equal(result.provider, 'kubectl');
    assert.equal(result.fallbackUsed, 'kubectl-fallback');
    assert.ok(calls.some((c) => c.cmd === 'kubectl'));
  });
});

describe('runAgentLoop', () => {
  it('skips release when review fails (secret diff)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ops-loop-'));
    const ws = path.join(dir, 'ws');
    await mkdir(ws, { recursive: true });
    let releaseCalled = false;
    const exec = async (req) => {
      if (req.cmd === 'git') {
        const args = (req.args ?? []).join(' ');
        if (args.includes('status')) {
          return { code: 0, stdout: '## fix\n M a.ts\n', stderr: '' };
        }
        if (args.includes('diff')) {
          return {
            code: 0,
            stdout: '+password = "supersecretpassword123"\n',
            stderr: '',
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      }
      if (String(req.cmd).includes('release') || (req.args ?? []).includes('release')) {
        releaseCalled = true;
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const fetchFn = async () => {
      releaseCalled = true;
      return { ok: true, status: 200, async text() { return 'ok'; } };
    };

    const result = await runAgentLoop({
      alert: {
        labels: { alertname: 'X', severity: 'warning', service: 'svc' },
        annotations: { summary: 'x' },
        status: 'firing',
      },
      config: loadOpsConfig({
        OPS_RELEASE_PROVIDER: 'http',
        OPS_RELEASE_WEBHOOK_URL: 'http://release.test/hook',
      }),
      exec,
      fetchFn,
      checkpointDir: path.join(dir, 'cp'),
      runId: 'review-block-1',
      coding: { workspaceDir: ws },
      injectedLogsText: 'ok',
      injectedPods: { items: [] },
      injectedEvents: { items: [] },
      skip: { diagnose: true, verify: true },
      retry: { retries: 0, minDelayMs: 1, maxDelayMs: 1, jitter: false, sleep: async () => {} },
    });

    assert.equal(result.ok, false);
    assert.equal(result.phase, 'failed');
    assert.equal(result.review?.ok, false);
    assert.equal(releaseCalled, false);
    assert.ok(result.notes.some((n) => /hard-stop/i.test(n)));
    await rm(dir, { recursive: true, force: true });
  });

  it('checkpoints and resumes after discover', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ops-resume-'));
    const cpDir = path.join(dir, 'cp');
    const common = {
      alert: {
        labels: { alertname: 'Y', severity: 'info', service: 'api', namespace: 'ns' },
        annotations: { summary: 'y' },
        status: 'firing',
      },
      config: loadOpsConfig({}),
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
      checkpointDir: cpDir,
      runId: 'resume-1',
      injectedLogsText: 'ERROR boom',
      injectedPods: { items: [] },
      injectedEvents: { items: [] },
      skip: {
        diagnose: true,
        fix: true,
        review: true,
        release: true,
        verify: true,
      },
      retry: { retries: 0, minDelayMs: 1, maxDelayMs: 1, jitter: false, sleep: async () => {} },
    };

    const first = await runAgentLoop(common);
    assert.equal(first.ok, true);
    assert.equal(first.phase, 'done');
    assert.ok(first.discovery);

    // Simulate partial checkpoint at discover only, then resume
    const store = new CheckpointStore({ dir: cpDir });
    await store.save({
      runId: 'resume-2',
      phase: 'discover',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      report: {
        ok: true,
        phases: [{ name: 'discover', ok: true }],
        discovery: first.discovery,
      },
      attemptCounts: { discover: 1 },
      breakerStates: [],
    });

    const second = await runAgentLoop({
      ...common,
      runId: 'resume-2',
      resumeFrom: true,
    });
    assert.equal(second.resumed, true);
    assert.equal(second.ok, true);
    assert.equal(second.phase, 'done');
    // discover should not be re-listed as a new failure; phase advanced
    assert.ok(second.notes.some((n) => /resumed/i.test(n)));
    await rm(dir, { recursive: true, force: true });
  });
});

describe('tool catalog agent loop', () => {
  it('includes agent loop tools', () => {
    const names = listOpsToolNames();
    assert.ok(names.includes('ops_agent_loop_start'));
    assert.ok(names.includes('ops_agent_loop_resume'));
    assert.ok(names.includes('ops_self_review'));
    assert.ok(names.includes('ops_discover'));
  });
});
