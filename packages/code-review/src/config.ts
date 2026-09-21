export type CrProvider = 'github' | 'gitlab';

export type CodeReviewConfig = {
  provider: CrProvider;
  /** owner/repo or group/project */
  repo?: string;
  githubToken?: string;
  gitlabToken?: string;
  gitlabUrl?: string;
  /** Optional lint/test shell; non-zero exit is recorded as a finding (not always hard-fail). */
  reviewCommand?: string;
  /** Run static checks phase by default in CodeReviewLoop. */
  enableStaticChecks: boolean;
  /** Post comment/note by default in CodeReviewLoop. */
  enablePublish: boolean;
  checkpointDir?: string;
  /** Diff line count above this → huge_diff warning. */
  hugeDiffLines: number;
  /** TODO/FIXME density per changed file above this → warning. */
  todoDensityThreshold: number;
};

function pick(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  if (v == null) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function pickBool(env: NodeJS.ProcessEnv, key: string, defaultValue: boolean): boolean {
  const v = pick(env, key);
  if (v == null) return defaultValue;
  const lower = v.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(lower)) return true;
  if (['0', 'false', 'no', 'off'].includes(lower)) return false;
  return defaultValue;
}

function pickInt(env: NodeJS.ProcessEnv, key: string, defaultValue: number): number {
  const v = pick(env, key);
  if (v == null) return defaultValue;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

export function loadCodeReviewConfig(env: NodeJS.ProcessEnv = process.env): CodeReviewConfig {
  const providerRaw = (pick(env, 'CR_PROVIDER') ?? 'github').toLowerCase();
  if (providerRaw !== 'github' && providerRaw !== 'gitlab') {
    throw new Error(`Invalid CR_PROVIDER: ${providerRaw} (expected github|gitlab)`);
  }
  const provider = providerRaw as CrProvider;
  return {
    provider,
    repo: pick(env, 'CR_REPO'),
    githubToken: pick(env, 'CR_GH_TOKEN') ?? pick(env, 'GH_TOKEN'),
    gitlabToken: pick(env, 'CR_GITLAB_TOKEN') ?? pick(env, 'GITLAB_TOKEN'),
    gitlabUrl: pick(env, 'CR_GITLAB_URL') ?? pick(env, 'GITLAB_URL'),
    reviewCommand: pick(env, 'CR_REVIEW_COMMAND'),
    enableStaticChecks: pickBool(env, 'CR_STATIC_CHECKS', true),
    enablePublish: pickBool(env, 'CR_PUBLISH', false),
    checkpointDir: pick(env, 'CR_CHECKPOINT_DIR'),
    hugeDiffLines: pickInt(env, 'CR_HUGE_DIFF_LINES', 800),
    todoDensityThreshold: pickInt(env, 'CR_TODO_DENSITY', 5),
  };
}

export function requireGithubAuth(cfg: CodeReviewConfig): { token: string; repo?: string } {
  if (!cfg.githubToken) {
    throw new Error('GitHub auth missing: set GH_TOKEN or CR_GH_TOKEN');
  }
  return { token: cfg.githubToken, repo: cfg.repo };
}

export function requireGitlabAuth(cfg: CodeReviewConfig): {
  token: string;
  repo?: string;
  gitlabUrl?: string;
} {
  if (!cfg.gitlabToken) {
    throw new Error('GitLab auth missing: set GITLAB_TOKEN or CR_GITLAB_TOKEN');
  }
  return {
    token: cfg.gitlabToken,
    repo: cfg.repo,
    gitlabUrl: cfg.gitlabUrl?.replace(/\/$/, ''),
  };
}

/** Env passed to gh/glab so tokens are not placed on argv. */
export function forgeCliEnv(cfg: CodeReviewConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (cfg.provider === 'github' && cfg.githubToken) {
    env.GH_TOKEN = cfg.githubToken;
    env.GITHUB_TOKEN = cfg.githubToken;
  }
  if (cfg.provider === 'gitlab' && cfg.gitlabToken) {
    env.GITLAB_TOKEN = cfg.gitlabToken;
    env.GLAB_TOKEN = cfg.gitlabToken;
  }
  if (cfg.gitlabUrl) {
    env.GITLAB_HOST = cfg.gitlabUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
  return env;
}
