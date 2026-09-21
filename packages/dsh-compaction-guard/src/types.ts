/** What triggered the host to consider compaction. */
export type CompactionTrigger = 'pressure' | 'context-overflow' | 'compact-now';

/** Read-only view available to a guard before compaction runs. */
export interface CompactionContext {
  trigger: CompactionTrigger;
  /** Estimated tokens of the durable routed request / surface. */
  estimatedTokens: number;
  /** Soft ceiling used by the host (e.g. floor(window * thresholdRatio)). */
  pressureFloor: number;
  /** Opaque session id from the host. */
  sessionId: string;
  /** Optional labels a plugin may have tracked (facts to preserve, etc.). */
  preserveHints?: readonly string[];
}

export interface CompactionPlan {
  /** Inclusive surface range or host-defined region id — opaque for now. */
  region?: { start: string; end: string };
  /** Free-form reason for evidence / upstream discussions. */
  reason: string;
  /** Optional summarizer directive override. */
  directive?: string;
}

export type CompactionDecision =
  | { kind: 'observe' }
  | { kind: 'veto'; reason: string }
  | { kind: 'replace'; plan: CompactionPlan };

export type CompactionGuard = (ctx: CompactionContext) => CompactionDecision | Promise<CompactionDecision>;
