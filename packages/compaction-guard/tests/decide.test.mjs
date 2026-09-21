import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  replaceWhenPreserving,
  runCompactionGuards,
  vetoNearFloor,
} from '../dist/index.js';

const base = {
  trigger: 'pressure',
  estimatedTokens: 10_100,
  pressureFloor: 10_000,
  sessionId: 'sess-1',
};

describe('runCompactionGuards', () => {
  it('returns observe when every guard observes', async () => {
    const decision = await runCompactionGuards(base, [() => ({ kind: 'observe' })]);
    assert.equal(decision.kind, 'observe');
  });

  it('lets the first non-observe win', async () => {
    const decision = await runCompactionGuards(base, [
      () => ({ kind: 'observe' }),
      () => ({ kind: 'veto', reason: 'first' }),
      () => ({ kind: 'veto', reason: 'second' }),
    ]);
    assert.deepEqual(decision, { kind: 'veto', reason: 'first' });
  });
});

describe('vetoNearFloor', () => {
  it('vetoes small overshoot on pressure', async () => {
    const decision = await runCompactionGuards(base, [vetoNearFloor(200)]);
    assert.equal(decision.kind, 'veto');
  });

  it('observes when far over the floor', async () => {
    const ctx = { ...base, estimatedTokens: 12_000 };
    const decision = await runCompactionGuards(ctx, [vetoNearFloor(200)]);
    assert.equal(decision.kind, 'observe');
  });
});

describe('replaceWhenPreserving', () => {
  it('replaces when preserve hints exist', async () => {
    const ctx = { ...base, preserveHints: ['keep-me'] };
    const decision = await runCompactionGuards(ctx, [
      replaceWhenPreserving(() => ({
        reason: 'keep hints',
        directive: 'Preserve preserveHints.',
      })),
    ]);
    assert.equal(decision.kind, 'replace');
  });
});
