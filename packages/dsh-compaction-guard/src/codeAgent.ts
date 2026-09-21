import type { CompactionContext, CompactionGuard } from './types.js';

/** Well-known preserve hint ids for coding-agent sessions. */
export const CODE_AGENT_HINTS = [
  'active-file',
  'diff',
  'failing-test',
  'user-constraint',
  'open-pr',
] as const;

export type CodeAgentHint = (typeof CODE_AGENT_HINTS)[number];

/**
 * For pressure: if a coding session is mid-edit (active-file or fresh failing-test),
 * veto once so the model can finish the current patch before summarization.
 */
export function vetoWhileEditing(options: { maxOverFloor?: number } = {}): CompactionGuard {
  const maxOverFloor = options.maxOverFloor ?? 512;
  return (ctx: CompactionContext) => {
    if (ctx.trigger !== 'pressure') {
      return { kind: 'observe' };
    }
    const hints = new Set(ctx.preserveHints ?? []);
    const editing = hints.has('active-file') || hints.has('failing-test');
    if (!editing) {
      return { kind: 'observe' };
    }
    const over = ctx.estimatedTokens - ctx.pressureFloor;
    if (over > 0 && over <= maxOverFloor) {
      return {
        kind: 'veto',
        reason: 'coding agent mid-edit / failing-test; defer compaction while slightly over floor',
      };
    }
    return { kind: 'observe' };
  };
}

/** Build a replace plan that tells the summarizer to keep coding hints verbatim. */
export function codeAgentPreservePlan(ctx: CompactionContext) {
  const hints = (ctx.preserveHints ?? []).filter((h) =>
    (CODE_AGENT_HINTS as readonly string[]).includes(h),
  );
  return {
    reason: hints.length
      ? `preserve coding-agent hints: ${hints.join(', ')}`
      : 'preserve coding-agent critical context',
    directive: [
      'You are compacting a coding-agent session.',
      'Keep verbatim: active file paths, current diff hunks, failing test names/stacks, and user constraints.',
      'Aggressively summarize repeated successful tool chatter and exploratory reads.',
      hints.length ? `Hints present: ${hints.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}
