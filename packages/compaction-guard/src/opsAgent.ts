import type { CompactionContext, CompactionGuard, CompactionPlan } from './types.js';
import { replaceWhenPreserving } from './decide.js';

/** Well-known preserve hint ids for oncall / ops-agent sessions. */
export const OPS_AGENT_HINTS = [
  'incident-id',
  'alert-rule',
  'failing-service',
  'recent-logs',
  'runbook-step',
  'timeline',
  'customer-impact',
] as const;

export type OpsAgentHint = (typeof OPS_AGENT_HINTS)[number];

/**
 * While an incident is actively being triaged, defer pressure compaction
 * so the model does not lose the alert + log spine mid-investigation.
 */
export function vetoWhileInvestigating(options: { maxOverFloor?: number } = {}): CompactionGuard {
  const maxOverFloor = options.maxOverFloor ?? 768;
  return (ctx: CompactionContext) => {
    if (ctx.trigger !== 'pressure') {
      return { kind: 'observe' };
    }
    const hints = new Set(ctx.preserveHints ?? []);
    const investigating =
      hints.has('incident-id') ||
      hints.has('alert-rule') ||
      hints.has('failing-service') ||
      hints.has('recent-logs') ||
      hints.has('runbook-step');
    if (!investigating) {
      return { kind: 'observe' };
    }
    const over = ctx.estimatedTokens - ctx.pressureFloor;
    if (over > 0 && over <= maxOverFloor) {
      return {
        kind: 'veto',
        reason:
          'ops agent mid-investigation; defer compaction while slightly over floor to keep alert/log spine',
      };
    }
    return { kind: 'observe' };
  };
}

/** Summarizer plan that keeps oncall-critical facts verbatim. */
export function opsAgentPreservePlan(ctx: CompactionContext): CompactionPlan {
  const hints = (ctx.preserveHints ?? []).filter((h) =>
    (OPS_AGENT_HINTS as readonly string[]).includes(h),
  );
  return {
    reason: hints.length
      ? `preserve ops-agent hints: ${hints.join(', ')}`
      : 'preserve ops-agent critical context',
    directive: [
      'You are compacting an oncall / ops-agent session.',
      'Keep verbatim: incident id, alert rule, failing service, customer impact, runbook step, and the latest error log lines / timeline anchors.',
      'Aggressively summarize repeated dashboard refreshes, successful health checks, and exploratory shell noise.',
      hints.length ? `Hints present: ${hints.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

/** Default guard stack for an ops / oncall agent on DSH + pi2dsh. */
export function defaultOpsAgentGuards(options: { maxOverFloor?: number } = {}): CompactionGuard[] {
  return [
    vetoWhileInvestigating({ maxOverFloor: options.maxOverFloor }),
    replaceWhenPreserving((ctx) => {
      const hasOps = (ctx.preserveHints ?? []).some((h) =>
        (OPS_AGENT_HINTS as readonly string[]).includes(h),
      );
      // replaceWhenPreserving already checks preserveHints length; keep plan ops-specific
      return hasOps
        ? opsAgentPreservePlan(ctx)
        : { reason: 'preserve session hints', directive: 'Preserve preserveHints verbatim.' };
    }),
  ];
}
