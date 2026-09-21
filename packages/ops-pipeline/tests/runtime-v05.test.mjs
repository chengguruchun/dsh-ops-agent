import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InMemoryEventBus } from '../dist/runtime/eventBus.js';
import {
  createDefaultDomainRegistry,
  DomainRegistry,
} from '../dist/runtime/domainRegistry.js';
import { runAgentLoop, loadAgentLoopCheckpoint } from '../dist/loop/agentLoop.js';
import { loadOpsConfig } from '../dist/config.js';

describe('V0.5 skeleton (experimental)', () => {
  it('in-memory event bus emits and records history', async () => {
    const bus = new InMemoryEventBus({ maxHistory: 10 });
    const seen = [];
    bus.on('ping', (e) => {
      seen.push(e.type);
    });
    await bus.emit('ping', { n: 1 });
    await bus.emit('other', {});
    assert.deepEqual(seen, ['ping']);
    assert.equal(bus.getHistory().length, 2);
  });

  it('domain registry lists ops + code-review siblings', () => {
    const reg = createDefaultDomainRegistry();
    assert.ok(reg.has('ops'));
    assert.ok(reg.has('code-review'));
    assert.equal(reg.get('ops').toolPrefix, 'ops_');
    assert.equal(reg.get('code-review').toolPrefix, 'cr_');
    assert.equal(reg.list().length, 2);
    const empty = new DomainRegistry();
    empty.register({
      id: 'custom',
      name: 'Custom',
      packageName: '@x/y',
      toolPrefix: 'x_',
      experimental: true,
    });
    assert.equal(empty.list()[0].experimental, true);
  });

  it('pauseAfterPhase + resume via checkpoint', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ops-pause-'));
    const bus = new InMemoryEventBus();
    try {
      const first = await runAgentLoop({
        alert: {
          labels: { alertname: 'P', severity: 'info', service: 's' },
          annotations: { summary: 'p' },
          status: 'firing',
        },
        config: loadOpsConfig({}),
        runId: 'pause-run-1',
        checkpointDir: dir,
        eventBus: bus,
        pauseAfterPhase: 'discover',
        skip: { diagnose: true, fix: true, review: true, release: true, verify: true },
        skipRiskGate: true,
        goal: 'pause demo',
      });
      assert.equal(first.agentState.paused, true);
      assert.ok(bus.getHistory().some((e) => e.type === 'agent.pause'));

      const cp = await loadAgentLoopCheckpoint('pause-run-1', dir);
      assert.equal(cp.agentState.paused, true);
      assert.equal(cp.agentState.goal, 'pause demo');

      const second = await runAgentLoop({
        alert: {
          labels: { alertname: 'P', severity: 'info', service: 's' },
          annotations: { summary: 'p' },
          status: 'firing',
        },
        config: loadOpsConfig({}),
        runId: 'pause-run-1',
        resumeFrom: true,
        checkpointDir: dir,
        eventBus: bus,
        skip: { discover: true, diagnose: true, fix: true, review: true, release: true, verify: true },
        skipRiskGate: true,
      });
      assert.equal(second.resumed, true);
      assert.equal(second.agentState.paused, false);
      assert.ok(bus.getHistory().some((e) => e.type === 'agent.resume'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
