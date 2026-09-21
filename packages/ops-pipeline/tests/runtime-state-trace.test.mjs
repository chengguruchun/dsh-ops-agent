import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createAgentState,
  cloneAgentState,
} from '../dist/runtime/agentState.js';
import {
  makeObservation,
  makeEvidence,
  makeDecision,
  makeAction,
  makeResult,
  makeVerification,
} from '../dist/runtime/evidence.js';
import {
  createExecutionTrace,
  appendObservation,
  appendEvidence,
  appendDecision,
  appendAction,
  appendResult,
  appendVerification,
} from '../dist/runtime/trace.js';
import { CheckpointStore } from '../dist/loop/checkpoint.js';

describe('V0.3 AgentState + Evidence + Trace', () => {
  it('builds linked IDs and append-only trace', () => {
    const obs = makeObservation({ source: 'logs', summary: 'error spike' });
    const ev = makeEvidence({
      observationIds: [obs.id],
      kind: 'log_signature',
      summary: 'OOMKilled',
    });
    const dec = makeDecision({
      evidenceIds: [ev.id],
      summary: 'roll restart',
      choice: 'release',
      riskLevel: 'L2',
    });
    const act = makeAction({
      decisionId: dec.id,
      kind: 'release_trigger',
      summary: 'webhook',
    });
    const res = makeResult({ actionId: act.id, ok: true, summary: '200' });
    const ver = makeVerification({
      resultIds: [res.id],
      ok: true,
      summary: 'rollout ok',
    });

    const trace = createExecutionTrace('run-1');
    appendObservation(trace, obs);
    appendEvidence(trace, ev);
    appendDecision(trace, dec);
    appendAction(trace, act);
    appendResult(trace, res);
    appendVerification(trace, ver);
    assert.equal(trace.events.length, 6);
    assert.equal(trace.events[0].type, 'observation');
    assert.equal(trace.events[5].refId, ver.id);

    const state = createAgentState({
      goal: 'restore checkout',
      phase: 'verify',
      observations: [obs],
      evidence: [ev],
      decisions: [dec],
      actions: [act],
      results: [res],
      verifications: [ver],
      trace,
    });
    assert.equal(state.goal, 'restore checkout');
    assert.equal(state.observations[0].id, obs.id);
  });

  it('checkpoint round-trips rich AgentState', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ops-state-'));
    try {
      const store = new CheckpointStore({ dir });
      const obs = makeObservation({ source: 'k8s', summary: 'crashloop' });
      const trace = createExecutionTrace('run-rt');
      appendObservation(trace, obs);
      const agentState = createAgentState({
        goal: 'fix crashloop',
        phase: 'diagnose',
        observations: [obs],
        trace,
        paused: false,
      });
      await store.save({
        runId: 'run-rt',
        phase: 'diagnose',
        startedAt: '2026-09-21T00:00:00.000Z',
        updatedAt: '2026-09-21T00:00:00.000Z',
        report: { ok: true, phases: [{ name: 'discover', ok: true }] },
        attemptCounts: { discover: 1 },
        breakerStates: [],
        agentState,
      });
      const loaded = await store.load('run-rt');
      assert.ok(loaded.agentState);
      assert.equal(loaded.agentState.goal, 'fix crashloop');
      assert.equal(loaded.agentState.observations[0].summary, 'crashloop');
      assert.equal(loaded.agentState.trace.events.length, 1);
      const cloned = cloneAgentState(loaded.agentState);
      cloned.notes = ['x'];
      assert.notEqual(cloned.notes, loaded.agentState.notes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
