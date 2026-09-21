import type { OpsConfig } from '../config.js';
import { requireRelease } from '../config.js';
import type { ExecFn } from '../exec.js';
import { assertOk } from '../exec.js';
import { helmUpgradeInstall } from './helm.js';

export type ReleasePayload = Record<string, unknown>;

export type ReleaseResult = {
  provider: OpsConfig['releaseProvider'];
  requestSummary: string;
  responseText: string;
};

export type FetchFn = typeof fetch;

export type HelmReleaseOverrides = {
  chart?: string;
  releaseName?: string;
  namespace?: string;
  valuesFiles?: string[];
  set?: Record<string, string>;
  imageRef?: string;
  timeout?: string;
  atomic?: boolean;
  createNamespace?: boolean;
};

/**
 * Trigger release via HTTP webhook, external script, or Helm upgrade --install.
 */
export async function triggerRelease(
  cfg: OpsConfig,
  exec: ExecFn,
  payload: ReleasePayload,
  fetchFn: FetchFn = fetch,
  helmOverrides?: HelmReleaseOverrides,
): Promise<ReleaseResult> {
  requireRelease(cfg);

  if (cfg.releaseProvider === 'helm') {
    const imageRef =
      helmOverrides?.imageRef ??
      (typeof payload.imageRef === 'string' ? payload.imageRef : undefined);
    const result = await helmUpgradeInstall(cfg, exec, {
      releaseName: helmOverrides?.releaseName ?? cfg.helmReleaseName!,
      chart: helmOverrides?.chart ?? cfg.helmChart!,
      namespace: helmOverrides?.namespace ?? cfg.helmNamespace,
      valuesFiles: helmOverrides?.valuesFiles ?? cfg.helmValuesFiles,
      set: helmOverrides?.set,
      imageRef,
      timeout: helmOverrides?.timeout ?? cfg.helmTimeout ?? '5m',
      atomic: helmOverrides?.atomic ?? true,
      createNamespace: helmOverrides?.createNamespace ?? true,
      wait: true,
    });
    return {
      provider: 'helm',
      requestSummary: result.requestSummary,
      responseText: result.stdout || result.stderr,
    };
  }

  if (cfg.releaseProvider === 'http') {
    const url = cfg.releaseWebhookUrl!;
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const responseText = await res.text();
    if (!res.ok) {
      throw new Error(`release webhook HTTP ${res.status}: ${responseText.slice(0, 500)}`);
    }
    return { provider: 'http', requestSummary: `POST ${url}`, responseText };
  }

  const script = cfg.releaseScript!;
  const env: NodeJS.ProcessEnv = {
    OPS_RELEASE_PAYLOAD: JSON.stringify(payload),
  };
  if (typeof payload.imageRef === 'string') env.OPS_RELEASE_IMAGE = payload.imageRef;
  if (typeof payload.version === 'string') env.OPS_RELEASE_VERSION = payload.version;

  const result = await exec({ cmd: script, args: [], env });
  assertOk(result, `release script ${script}`);
  return {
    provider: 'script',
    requestSummary: `${script} (env OPS_RELEASE_PAYLOAD)`,
    responseText: result.stdout,
  };
}
