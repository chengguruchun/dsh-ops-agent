import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  codeAgentPreservePlan,
  replaceWhenPreserving,
  runCompactionGuards,
  vetoWhileEditing,
} from '../dist/index.js';

const base = {
  trigger: 'pressure',
  estimatedTokens: 10_200,
  pressureFloor: 10_000,
  sessionId: 'sess-code',
};

describe('vetoWhileEditing', () => {
  it('vetoes slight overshoot when active-file is set', async () => {
    const ctx = { ...base, preserveHints: ['active-file'] };
    const decision = await runCompactionGuards(ctx, [vetoWhileEditing()]);
    assert.equal(decision.kind, 'veto');
  });

  it('observes when not editing', async () => {
    const decision = await runCompactionGuards(base, [vetoWhileEditing()]);
    assert.equal(decision.kind, 'observe');
  });
});

describe('codeAgentPreservePlan', () => {
  it('drives replace with coding hints', async () => {
    const ctx = {
      ...base,
      preserveHints: ['diff', 'failing-test', 'noise'],
    };
    const decision = await runCompactionGuards(ctx, [
      replaceWhenPreserving(codeAgentPreservePlan),
    ]);
    assert.equal(decision.kind, 'replace');
    if (decision.kind === 'replace') {
      assert.match(decision.plan.reason, /diff/);
      assert.match(decision.plan.directive, /failing test/i);
    }
  });
});
