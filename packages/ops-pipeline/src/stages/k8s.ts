import type { OpsConfig } from '../config.js';
import { kubectlContextArgs, kubectlEnv } from '../config.js';
import type { ExecFn } from '../exec.js';
import { assertOk } from '../exec.js';

export type K8sJson = Record<string, unknown>;

async function kubectlJson(
  cfg: OpsConfig,
  exec: ExecFn,
  args: string[],
  label: string,
): Promise<{ data: K8sJson; requestSummary: string }> {
  const full = [...args, ...kubectlContextArgs(cfg), '-o', 'json'];
  const result = await exec({ cmd: 'kubectl', args: full, env: kubectlEnv(cfg) });
  assertOk(result, label);
  const data = JSON.parse(result.stdout || '{}') as K8sJson;
  return { data, requestSummary: `kubectl ${full.join(' ')}` };
}

export async function getPods(
  cfg: OpsConfig,
  exec: ExecFn,
  opts: { namespace?: string; labelSelector?: string } = {},
): Promise<{ data: K8sJson; requestSummary: string }> {
  const args = ['get', 'pods'];
  if (opts.namespace) args.push('-n', opts.namespace);
  else args.push('-A');
  if (opts.labelSelector) args.push('-l', opts.labelSelector);
  return kubectlJson(cfg, exec, args, 'kubectl get pods');
}

export async function getEvents(
  cfg: OpsConfig,
  exec: ExecFn,
  opts: { namespace?: string } = {},
): Promise<{ data: K8sJson; requestSummary: string }> {
  const args = ['get', 'events', '--sort-by=.lastTimestamp'];
  if (opts.namespace) args.push('-n', opts.namespace);
  else args.push('-A');
  return kubectlJson(cfg, exec, args, 'kubectl get events');
}

export async function describePod(
  cfg: OpsConfig,
  exec: ExecFn,
  opts: { name: string; namespace?: string },
): Promise<{ text: string; requestSummary: string }> {
  const args = ['describe', 'pod', opts.name, ...kubectlContextArgs(cfg)];
  if (opts.namespace) args.push('-n', opts.namespace);
  const result = await exec({ cmd: 'kubectl', args, env: kubectlEnv(cfg) });
  assertOk(result, 'kubectl describe pod');
  return { text: result.stdout, requestSummary: `kubectl ${args.join(' ')}` };
}

export async function getDeployments(
  cfg: OpsConfig,
  exec: ExecFn,
  opts: { namespace?: string; name?: string } = {},
): Promise<{ data: K8sJson; requestSummary: string }> {
  const args = ['get', 'deploy'];
  if (opts.name) args.push(opts.name);
  if (opts.namespace) args.push('-n', opts.namespace);
  else if (!opts.name) args.push('-A');
  return kubectlJson(cfg, exec, args, 'kubectl get deploy');
}

export async function rolloutStatus(
  cfg: OpsConfig,
  exec: ExecFn,
  opts: { name: string; namespace?: string; timeout?: string },
): Promise<{ text: string; requestSummary: string }> {
  const args = ['rollout', 'status', `deployment/${opts.name}`, ...kubectlContextArgs(cfg)];
  if (opts.namespace) args.push('-n', opts.namespace);
  if (opts.timeout) args.push(`--timeout=${opts.timeout}`);
  const result = await exec({ cmd: 'kubectl', args, env: kubectlEnv(cfg) });
  assertOk(result, 'kubectl rollout status');
  return { text: result.stdout, requestSummary: `kubectl ${args.join(' ')}` };
}
