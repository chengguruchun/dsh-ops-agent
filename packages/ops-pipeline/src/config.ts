export type LogProvider = 'kubectl' | 'loki' | 'http';
export type ReleaseProvider = 'http' | 'script' | 'helm';

export type OpsConfig = {
  gitlabUrl?: string;
  gitlabToken?: string;
  gitlabProject?: string;
  kubeconfig?: string;
  kubeContext?: string;
  dockerRegistry?: string;
  dockerNamespace?: string;
  dockerUsername?: string;
  /** Password only from env — never log. */
  dockerPassword?: string;
  logProvider: LogProvider;
  lokiUrl?: string;
  logHttpUrl?: string;
  releaseProvider: ReleaseProvider;
  releaseWebhookUrl?: string;
  releaseScript?: string;
  /** Helm chart path or repo/chart ref (when releaseProvider=helm) */
  helmChart?: string;
  helmReleaseName?: string;
  helmNamespace?: string;
  helmValuesFiles?: string[];
  helmTimeout?: string;
  metricsHttpUrl?: string;
};

function pick(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  if (v == null) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

export function loadOpsConfig(env: NodeJS.ProcessEnv = process.env): OpsConfig {
  const logProvider = (pick(env, 'OPS_LOG_PROVIDER') ?? 'kubectl') as LogProvider;
  const releaseProvider = (pick(env, 'OPS_RELEASE_PROVIDER') ?? 'http') as ReleaseProvider;
  if (logProvider !== 'kubectl' && logProvider !== 'loki' && logProvider !== 'http') {
    throw new Error(`Invalid OPS_LOG_PROVIDER: ${logProvider}`);
  }
  if (releaseProvider !== 'http' && releaseProvider !== 'script' && releaseProvider !== 'helm') {
    throw new Error(`Invalid OPS_RELEASE_PROVIDER: ${releaseProvider}`);
  }
  const valuesRaw = pick(env, 'OPS_HELM_VALUES_FILES');
  return {
    gitlabUrl: pick(env, 'OPS_GITLAB_URL'),
    gitlabToken: pick(env, 'OPS_GITLAB_TOKEN'),
    gitlabProject: pick(env, 'OPS_GITLAB_PROJECT'),
    kubeconfig: pick(env, 'OPS_KUBECONFIG'),
    kubeContext: pick(env, 'OPS_KUBE_CONTEXT'),
    dockerRegistry: pick(env, 'OPS_DOCKER_REGISTRY'),
    dockerNamespace: pick(env, 'OPS_DOCKER_NAMESPACE'),
    dockerUsername: pick(env, 'OPS_DOCKER_USERNAME'),
    dockerPassword: pick(env, 'OPS_DOCKER_PASSWORD'),
    logProvider,
    lokiUrl: pick(env, 'OPS_LOKI_URL'),
    logHttpUrl: pick(env, 'OPS_LOG_HTTP_URL'),
    releaseProvider,
    releaseWebhookUrl: pick(env, 'OPS_RELEASE_WEBHOOK_URL'),
    releaseScript: pick(env, 'OPS_RELEASE_SCRIPT'),
    helmChart: pick(env, 'OPS_HELM_CHART'),
    helmReleaseName: pick(env, 'OPS_HELM_RELEASE'),
    helmNamespace: pick(env, 'OPS_HELM_NAMESPACE'),
    helmValuesFiles: valuesRaw ? valuesRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    helmTimeout: pick(env, 'OPS_HELM_TIMEOUT'),
    metricsHttpUrl: pick(env, 'OPS_METRICS_HTTP_URL'),
  };
}

export function requireGitlab(cfg: OpsConfig): {
  gitlabUrl: string;
  gitlabToken: string;
  gitlabProject: string;
} {
  if (!cfg.gitlabUrl || !cfg.gitlabToken || !cfg.gitlabProject) {
    throw new Error(
      'GitLab config incomplete: set OPS_GITLAB_URL, OPS_GITLAB_TOKEN, OPS_GITLAB_PROJECT',
    );
  }
  return {
    gitlabUrl: cfg.gitlabUrl.replace(/\/$/, ''),
    gitlabToken: cfg.gitlabToken,
    gitlabProject: cfg.gitlabProject,
  };
}

export function requireMetricsUrl(cfg: OpsConfig): string {
  if (!cfg.metricsHttpUrl) {
    throw new Error('Metrics not configured: set OPS_METRICS_HTTP_URL');
  }
  return cfg.metricsHttpUrl;
}

export function requireRelease(cfg: OpsConfig): void {
  if (cfg.releaseProvider === 'http' && !cfg.releaseWebhookUrl) {
    throw new Error('Release HTTP provider needs OPS_RELEASE_WEBHOOK_URL');
  }
  if (cfg.releaseProvider === 'script' && !cfg.releaseScript) {
    throw new Error('Release script provider needs OPS_RELEASE_SCRIPT');
  }
  if (cfg.releaseProvider === 'helm') {
    if (!cfg.helmChart || !cfg.helmReleaseName) {
      throw new Error('Release helm provider needs OPS_HELM_CHART and OPS_HELM_RELEASE');
    }
  }
}

export function kubectlEnv(cfg: OpsConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (cfg.kubeconfig) env.KUBECONFIG = cfg.kubeconfig;
  return env;
}

export function kubectlContextArgs(cfg: OpsConfig): string[] {
  return cfg.kubeContext ? ['--context', cfg.kubeContext] : [];
}
