import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defaultOpsAgentGuards,
  opsAgentPreservePlan,
  runCompactionGuards,
  vetoWhileInvestigating,
} from '../dist/index.js';

const base = {
  trigger: 'pressure',
  estimatedTokens: 10_400,
  pressureFloor: 10_000,
  sessionId: 'inc-sess',
};

describe('vetoWhileInvestigating', () => {
  it('vetoes slight overshoot when incident-id is set', async () => {
    const ctx = { ...base, preserveHints: ['incident-id', 'recent-logs'] };
    const decision = await runCompactionGuards(ctx, [vetoWhileInvestigating()]);
    assert.equal(decision.kind, 'veto');
  });

  it('observes when not investigating', async () => {
    const decision = await runCompactionGuards(base, [vetoWhileInvestigating()]);
    assert.equal(decision.kind, 'observe');
  });
});

describe('defaultOpsAgentGuards', () => {
  it('replaces with ops preserve plan when overshoot is large', async () => {
    const ctx = {
      ...base,
      estimatedTokens: 12_000,
      preserveHints: ['alert-rule', 'failing-service', 'timeline'],
    };
    const decision = await runCompactionGuards(ctx, defaultOpsAgentGuards());
    assert.equal(decision.kind, 'replace');
    if (decision.kind === 'replace') {
      assert.match(decision.plan.directive, /oncall/i);
      assert.match(opsAgentPreservePlan(ctx).reason, /alert-rule/);
    }
  });
});
