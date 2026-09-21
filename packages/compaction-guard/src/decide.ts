import type { CompactionContext, CompactionDecision, CompactionGuard, CompactionPlan } from './types.js';

/**
 * Pure reducer over ordered guards.
 * First non-observe decision wins; if all observe, result is observe.
 *
 * This models the *intended* DSH-ARCH-004 waterfall once the host exposes it.
 * Today stock DSH has no public pre-compaction cancel/replace seam —
 * calling this from a real host still requires a sidecar or upstream change.
 */
export async function runCompactionGuards(
  ctx: CompactionContext,
  guards: readonly CompactionGuard[],
): Promise<CompactionDecision> {
  for (const guard of guards) {
    const decision = await guard(ctx);
    if (decision.kind !== 'observe') {
      return decision;
    }
  }
  return { kind: 'observe' };
}

/** Skip automatic compaction when pressure is only slightly over the floor. */
export function vetoNearFloor(marginTokens: number): CompactionGuard {
  return (ctx) => {
    if (ctx.trigger !== 'pressure') {
      return { kind: 'observe' };
    }
    const over = ctx.estimatedTokens - ctx.pressureFloor;
    if (over > 0 && over <= marginTokens) {
      return {
        kind: 'veto',
        reason: `over floor by only ${over} tokens (≤ ${marginTokens}); defer compaction`,
      };
    }
    return { kind: 'observe' };
  };
}

/** Replace the default plan when preserve hints are present. */
export function replaceWhenPreserving(planFactory: (ctx: CompactionContext) => CompactionPlan): CompactionGuard {
  return (ctx) => {
    if (!ctx.preserveHints?.length) {
      return { kind: 'observe' };
    }
    return { kind: 'replace', plan: planFactory(ctx) };
  };
}
