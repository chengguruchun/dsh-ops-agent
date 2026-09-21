import type { OpsConfig } from '../config.js';
import type { ExecFn } from '../exec.js';
import { queryLogs } from './logs.js';
import { rolloutStatus } from './k8s.js';

export type VerifyOpts = {
  deployment: string;
  namespace?: string;
  timeout?: string;
  logQuery?: {
    service?: string;
    namespace?: string;
    since?: string;
    query?: string;
    pod?: string;
  };
};

export type VerifyResult = {
  rollout: { text: string; requestSummary: string };
  logs?: { text: string; requestSummary: string; provider: string };
};

export async function verifyRelease(
  cfg: OpsConfig,
  exec: ExecFn,
  opts: VerifyOpts,
): Promise<VerifyResult> {
  const rollout = await rolloutStatus(cfg, exec, {
    name: opts.deployment,
    namespace: opts.namespace,
    timeout: opts.timeout ?? '120s',
  });

  let logs: VerifyResult['logs'];
  if (opts.logQuery) {
    const logResult = await queryLogs(cfg, exec, {
      ...opts.logQuery,
      namespace: opts.logQuery.namespace ?? opts.namespace,
    });
    logs = {
      text: logResult.text,
      requestSummary: logResult.requestSummary,
      provider: logResult.provider,
    };
  }

  return { rollout, logs };
}
