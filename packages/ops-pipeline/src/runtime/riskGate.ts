/**
 * V0.2 Risk Gate — classify mutating actions L0–L4 and enforce policy
 * before release / mutating stages.
 *
 * Policy defaults:
 *   L0 auto | L1 auto+verify | L2 review | L3 approval | L4 human-only
 *
 * Env unlock for L3: OPS_RISK_APPROVED=1 or options.approved=true
 * Hard deny always for L4 (human-only) unless OPS_RISK_HUMAN_UNLOCK=1 (tests/break-glass).
 */

export type RiskLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export type RiskPolicy =
  | 'auto'
  | 'auto_verify'
  | 'review'
  | 'approval'
  | 'human_only';

export type RiskVerdict = 'allow' | 'allow_with_verify' | 'require_review' | 'require_approval' | 'deny';

export type MutatingActionKind =
  | 'read_only'
  | 'git_commit'
  | 'git_push'
  | 'docker_build'
  | 'docker_push'
  | 'kubectl_apply'
  | 'kubectl_delete'
  | 'kubectl_scale'
  | 'helm_upgrade'
  | 'helm_uninstall'
  | 'release_trigger'
  | 'gitlab_issue'
  | 'gitlab_mr'
  | 'secret_touch'
  | 'unknown_mutate';

export type MutatingAction = {
  kind: MutatingActionKind | string;
  /** Free-form command / argv summary for pattern classification. */
  command?: string;
  summary?: string;
  target?: string;
};

export type RiskDecision = {
  id: string;
  level: RiskLevel;
  policy: RiskPolicy;
  verdict: RiskVerdict;
  action: MutatingAction;
  reason: string;
  approved: boolean;
  at: string;
};

export type RiskGateOptions = {
  /** Explicit approval for L3 (or env OPS_RISK_APPROVED). */
  approved?: boolean;
  /** Break-glass for L4 in controlled tests (or env OPS_RISK_HUMAN_UNLOCK). */
  humanUnlock?: boolean;
  /** Override default policy map. */
  policyByLevel?: Partial<Record<RiskLevel, RiskPolicy>>;
  env?: NodeJS.ProcessEnv;
  /** Injectable clock / id for tests. */
  now?: () => string;
  newId?: () => string;
};

const DEFAULT_POLICY: Record<RiskLevel, RiskPolicy> = {
  L0: 'auto',
  L1: 'auto_verify',
  L2: 'review',
  L3: 'approval',
  L4: 'human_only',
};

const KIND_LEVEL: Record<string, RiskLevel> = {
  read_only: 'L0',
  gitlab_issue: 'L1',
  git_commit: 'L1',
  docker_build: 'L1',
  gitlab_mr: 'L2',
  docker_push: 'L2',
  release_trigger: 'L2',
  kubectl_apply: 'L3',
  kubectl_scale: 'L3',
  helm_upgrade: 'L3',
  git_push: 'L3',
  kubectl_delete: 'L4',
  helm_uninstall: 'L4',
  secret_touch: 'L4',
  unknown_mutate: 'L3',
};

const COMMAND_RULES: Array<{ re: RegExp; level: RiskLevel; kind: MutatingActionKind }> = [
  { re: /\bkubectl\s+delete\b/i, level: 'L4', kind: 'kubectl_delete' },
  { re: /\bhelm\s+uninstall\b/i, level: 'L4', kind: 'helm_uninstall' },
  { re: /\b(helm\s+upgrade|helm\s+install)\b/i, level: 'L3', kind: 'helm_upgrade' },
  { re: /\bkubectl\s+apply\b/i, level: 'L3', kind: 'kubectl_apply' },
  { re: /\bkubectl\s+scale\b/i, level: 'L3', kind: 'kubectl_scale' },
  { re: /\bdocker\s+push\b/i, level: 'L2', kind: 'docker_push' },
  { re: /\bdocker\s+build\b/i, level: 'L1', kind: 'docker_build' },
  { re: /\bgit\s+push\b/i, level: 'L3', kind: 'git_push' },
  { re: /\bgit\s+commit\b/i, level: 'L1', kind: 'git_commit' },
];

let idSeq = 0;
function defaultId(): string {
  idSeq += 1;
  return `risk_${Date.now().toString(36)}_${idSeq}`;
}

export function classifyMutatingAction(action: MutatingAction): {
  level: RiskLevel;
  kind: string;
  reason: string;
} {
  const cmd = `${action.command ?? ''} ${action.summary ?? ''}`.trim();
  for (const rule of COMMAND_RULES) {
    if (cmd && rule.re.test(cmd)) {
      return {
        level: rule.level,
        kind: rule.kind,
        reason: `command matched ${rule.re.source}`,
      };
    }
  }
  const kind = action.kind || 'unknown_mutate';
  const level = KIND_LEVEL[kind] ?? 'L3';
  return {
    level,
    kind,
    reason: `action kind=${kind} → ${level}`,
  };
}

export function policyForLevel(
  level: RiskLevel,
  overrides?: Partial<Record<RiskLevel, RiskPolicy>>,
): RiskPolicy {
  return overrides?.[level] ?? DEFAULT_POLICY[level];
}

function verdictFromPolicy(policy: RiskPolicy): RiskVerdict {
  switch (policy) {
    case 'auto':
      return 'allow';
    case 'auto_verify':
      return 'allow_with_verify';
    case 'review':
      return 'require_review';
    case 'approval':
      return 'require_approval';
    case 'human_only':
      return 'deny';
  }
}

/**
 * Evaluate risk gate. Throws RiskGateDeniedError on hard deny.
 * Does not throw for require_*; caller decides hard-stop vs soft pause.
 */
export function evaluateRiskGate(
  action: MutatingAction,
  opts: RiskGateOptions = {},
): RiskDecision {
  const env = opts.env ?? process.env;
  const classified = classifyMutatingAction(action);
  const level = classified.level;
  const policy = policyForLevel(level, opts.policyByLevel);
  const approved =
    opts.approved === true ||
    pickTruthy(env.OPS_RISK_APPROVED) ||
    pickTruthy(env.OPS_RISK_L3_UNLOCK);
  const humanUnlock =
    opts.humanUnlock === true || pickTruthy(env.OPS_RISK_HUMAN_UNLOCK);

  let verdict = verdictFromPolicy(policy);
  let reason = classified.reason;

  if (verdict === 'require_approval' && approved) {
    verdict = 'allow_with_verify';
    reason = `${reason}; L3 approved`;
  }

  if (verdict === 'deny' && humanUnlock) {
    verdict = 'require_approval';
    reason = `${reason}; human unlock → still requires explicit approval path`;
  }

  // L4 remains deny unless humanUnlock AND approved
  if (level === 'L4') {
    if (humanUnlock && approved) {
      verdict = 'allow_with_verify';
      reason = `${reason}; L4 break-glass approved`;
    } else if (!humanUnlock) {
      verdict = 'deny';
      reason = `${reason}; L4 human-only — denied`;
    }
  }

  const decision: RiskDecision = {
    id: (opts.newId ?? defaultId)(),
    level,
    policy,
    verdict,
    action: { ...action, kind: classified.kind },
    reason,
    approved: Boolean(approved),
    at: (opts.now ?? (() => new Date().toISOString()))(),
  };

  return decision;
}

/** True when the action must not proceed. */
export function isRiskDenied(decision: RiskDecision): boolean {
  return decision.verdict === 'deny' || decision.verdict === 'require_approval';
}

export class RiskGateDeniedError extends Error {
  readonly decision: RiskDecision;

  constructor(decision: RiskDecision) {
    super(
      `Risk gate denied (${decision.level}/${decision.verdict}): ${decision.reason}`,
    );
    this.name = 'RiskGateDeniedError';
    this.decision = decision;
  }
}

/**
 * Hard-stop helper: deny | require_approval (without approved) throws.
 * require_review is allowed through if `reviewPassed` is true.
 */
export function assertRiskAllowed(
  decision: RiskDecision,
  opts: { reviewPassed?: boolean } = {},
): void {
  if (decision.verdict === 'deny') {
    throw new RiskGateDeniedError(decision);
  }
  if (decision.verdict === 'require_approval' && !decision.approved) {
    throw new RiskGateDeniedError(decision);
  }
  if (decision.verdict === 'require_review' && opts.reviewPassed === false) {
    throw new RiskGateDeniedError({
      ...decision,
      verdict: 'deny',
      reason: `${decision.reason}; review not passed`,
    });
  }
}

function pickTruthy(v: string | undefined): boolean {
  if (v == null) return false;
  const t = v.trim().toLowerCase();
  return t === '1' || t === 'true' || t === 'yes' || t === 'on';
}

export const RISK_DEFAULT_POLICY = DEFAULT_POLICY;
