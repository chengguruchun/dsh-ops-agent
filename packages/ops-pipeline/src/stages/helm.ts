import type { OpsConfig } from '../config.js';
import { kubectlEnv } from '../config.js';
import type { ExecFn } from '../exec.js';
import { assertOk } from '../exec.js';

export type HelmDeployOpts = {
  /** Helm release name */
  releaseName: string;
  chart: string;
  namespace?: string;
  /** Create namespace if missing */
  createNamespace?: boolean;
  valuesFiles?: string[];
  /** --set key=value pairs */
  set?: Record<string, string>;
  /** Convenience: set image repository/tag (common chart pattern) */
  imageRef?: string;
  imageRepoKey?: string; // default image.repository
  imageTagKey?: string; // default image.tag
  wait?: boolean;
  timeout?: string;
  atomic?: boolean;
  dryRun?: boolean;
  extraArgs?: string[];
};

export type HelmDeployResult = {
  requestSummary: string;
  stdout: string;
  stderr: string;
};

function splitImageRef(ref: string): { repository: string; tag: string } {
  const idx = ref.lastIndexOf(':');
  if (idx <= 0 || ref.slice(idx + 1).includes('/')) {
    return { repository: ref, tag: 'latest' };
  }
  return { repository: ref.slice(0, idx), tag: ref.slice(idx + 1) };
}

/**
 * Real Helm deploy: `helm upgrade --install`.
 * Uses same kubeconfig/context as kubectl helpers when configured.
 */
export async function helmUpgradeInstall(
  cfg: OpsConfig,
  exec: ExecFn,
  opts: HelmDeployOpts,
): Promise<HelmDeployResult> {
  const args = ['upgrade', '--install', opts.releaseName, opts.chart];

  if (opts.namespace) args.push('-n', opts.namespace);
  if (opts.createNamespace) args.push('--create-namespace');

  for (const f of opts.valuesFiles ?? []) {
    args.push('-f', f);
  }

  const setMap: Record<string, string> = { ...(opts.set ?? {}) };
  if (opts.imageRef) {
    const { repository, tag } = splitImageRef(opts.imageRef);
    setMap[opts.imageRepoKey ?? 'image.repository'] = repository;
    setMap[opts.imageTagKey ?? 'image.tag'] = tag;
  }
  for (const [k, v] of Object.entries(setMap)) {
    args.push('--set', `${k}=${v}`);
  }

  if (opts.wait !== false) args.push('--wait');
  if (opts.timeout) args.push('--timeout', opts.timeout);
  if (opts.atomic) args.push('--atomic');
  if (opts.dryRun) args.push('--dry-run');

  if (cfg.kubeContext) {
    args.push('--kube-context', cfg.kubeContext);
  }
  if (opts.extraArgs?.length) args.push(...opts.extraArgs);

  const env = kubectlEnv(cfg);
  const result = await exec({ cmd: 'helm', args, env });
  assertOk(result, 'helm upgrade --install');
  return {
    requestSummary: `helm ${args.join(' ')}`,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function helmStatus(
  cfg: OpsConfig,
  exec: ExecFn,
  opts: { releaseName: string; namespace?: string },
): Promise<HelmDeployResult> {
  const args = ['status', opts.releaseName];
  if (opts.namespace) args.push('-n', opts.namespace);
  if (cfg.kubeContext) args.push('--kube-context', cfg.kubeContext);
  const result = await exec({ cmd: 'helm', args, env: kubectlEnv(cfg) });
  assertOk(result, 'helm status');
  return {
    requestSummary: `helm ${args.join(' ')}`,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function helmRollback(
  cfg: OpsConfig,
  exec: ExecFn,
  opts: { releaseName: string; namespace?: string; revision?: number; wait?: boolean },
): Promise<HelmDeployResult> {
  const args = ['rollback', opts.releaseName];
  if (opts.revision != null) args.push(String(opts.revision));
  if (opts.namespace) args.push('-n', opts.namespace);
  if (opts.wait !== false) args.push('--wait');
  if (cfg.kubeContext) args.push('--kube-context', cfg.kubeContext);
  const result = await exec({ cmd: 'helm', args, env: kubectlEnv(cfg) });
  assertOk(result, 'helm rollback');
  return {
    requestSummary: `helm ${args.join(' ')}`,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
