/**
 * Map Pi `session_before_compact` → @dsh-ops-agent/compaction-guard.
 *
 * Pi ABI exposes cancel/replace on this event. Stock DSH's native
 * DSH-ARCH-004 seam is still incomplete; through pi2dsh the Pi event is the
 * practical hook. If the host never fires it, this is a no-op.
 */

import {
  defaultOpsAgentGuards,
  runCompactionGuards,
  type CompactionContext,
  type CompactionTrigger,
} from '@dsh-ops-agent/compaction-guard';
import type { OpsToolRuntime } from './deps.js';
import type {
  PiExtensionAPI,
  PiSessionBeforeCompactEvent,
  PiSessionBeforeCompactResult,
} from './pi-abi.js';

function mapTrigger(reason: PiSessionBeforeCompactEvent['reason']): CompactionTrigger {
  if (reason === 'threshold') return 'pressure';
  if (reason === 'overflow') return 'context-overflow';
  return 'compact-now';
}

function estimatedTokens(event: PiSessionBeforeCompactEvent): number {
  const prep = event.preparation ?? {};
  return (
    prep.estimatedTokens ??
    prep.tokensBefore ??
    prep.tokenCount ??
    prep.threshold ??
    0
  );
}

export function registerCompactionGuard(
  pi: PiExtensionAPI,
  runtime: OpsToolRuntime,
): void {
  const guards = defaultOpsAgentGuards();

  pi.on('session_before_compact', async (raw) => {
    const event = raw as PiSessionBeforeCompactEvent;
    const ctx: CompactionContext = {
      trigger: mapTrigger(event.reason ?? 'manual'),
      estimatedTokens: estimatedTokens(event),
      pressureFloor: event.preparation?.pressureFloor ?? runtime.pressureFloor,
      sessionId: 'pi-session',
      preserveHints: runtime.getPreserveHints(),
    };

    const decision = await runCompactionGuards(ctx, guards);

    if (decision.kind === 'veto') {
      const result: PiSessionBeforeCompactResult = { cancel: true };
      return result;
    }

    if (decision.kind === 'replace') {
      const result: PiSessionBeforeCompactResult = {
        customInstructions: decision.plan.directive ?? decision.plan.reason,
      };
      return result;
    }

    return undefined;
  });
}
