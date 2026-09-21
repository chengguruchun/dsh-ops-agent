import type { OpsConfig } from './config.js';
import { loadOpsConfig } from './config.js';
import type { ExecFn } from './exec.js';
import { createProcessExec } from './exec.js';
import { normalizeAlert, type NormalizedAlert } from './stages/alert.js';
import { queryLogs } from './stages/logs.js';
import { queryMetrics } from './stages/metrics.js';
import { getEvents, getPods } from './stages/k8s.js';
import { createGitlabClient } from './stages/gitlab.js';
import { createCodingWorkspace } from './stages/coding.js';
import { buildAndPushImage } from './stages/image.js';
import { triggerRelease } from './stages/release.js';
import { verifyRelease } from './stages/verify.js';

export type PipelineStepName =
  | 'alert'
  | 'logs'
  | 'metrics'
  | 'k8s'
  | 'gitlab'
  | 'coding'
  | 'image'
  | 'release'
  | 'verify';

export type PipelineStepResult = {
  name: PipelineStepName;
  ok: boolean;
  skipped?: boolean;
  requestSummary?: string;
  outputs?: unknown;
  error?: string;
};

export type PipelineReport = {
  ok: boolean;
  alert?: NormalizedAlert;
  steps: PipelineStepResult[];
  startedAt: string;
  finishedAt: string;
};

export type PipelineSkip = Partial<Record<PipelineStepName, boolean>>;

export type OpsClosedLoopContext = {
  alert: unknown;
  config?: OpsConfig;
  exec?: ExecFn;
  fetchFn?: typeof fetch;
  skip?: PipelineSkip;
  coding?: {
    workspaceDir: string;
    repoUrl?: string;
    branch?: string;
    patchFile?: string;
    commitMessage?: string;
  };
  image?: {
    contextDir: string;
    dockerfile?: string;
    imageName: string;
    tag: string;
    fullRef?: string;
    login?: boolean;
  };
  release?: { payload?: Record<string, unknown> };
  verify?: { deployment: string; namespace?: string; timeout?: string };
  gitlabSearch?: string;
  issue?: { title?: string; description?: string; labels?: string[] };
  mergeRequest?: {
    sourceBranch: string;
    targetBranch?: string;
    title?: string;
    description?: string;
  };
};

function stepError(name: PipelineStepName, err: unknown): PipelineStepResult {
  return {
    name,
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  };
}

export async function runOpsClosedLoop(ctx: OpsClosedLoopContext): Promise<PipelineReport> {
  const startedAt = new Date().toISOString();
  const cfg = ctx.config ?? loadOpsConfig();
  const exec = ctx.exec ?? createProcessExec();
  const fetchFn = ctx.fetchFn ?? fetch;
  const skip = ctx.skip ?? {};
  const steps: PipelineStepResult[] = [];
  let alert: NormalizedAlert | undefined;
  let imageRef: string | undefined;

  // alert
  if (skip.alert) {
    steps.push({ name: 'alert', ok: true, skipped: true });
  } else {
    try {
      alert = normalizeAlert(ctx.alert);
      steps.push({
        name: 'alert',
        ok: true,
        requestSummary: `normalizeAlert(${alert.name})`,
        outputs: {
          fingerprint: alert.fingerprint,
          name: alert.name,
          severity: alert.severity,
          service: alert.service,
          namespace: alert.namespace,
        },
      });
    } catch (err) {
      steps.push(stepError('alert', err));
      return {
        ok: false,
        alert,
        steps,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }
  }

  const service = alert?.service;
  const namespace = alert?.namespace;

  // logs
  if (skip.logs) {
    steps.push({ name: 'logs', ok: true, skipped: true });
  } else {
    try {
      const canRun =
        cfg.logProvider === 'kubectl'
          ? Boolean(service || alert?.pod)
          : cfg.logProvider === 'loki'
            ? Boolean(cfg.lokiUrl)
            : Boolean(cfg.logHttpUrl);
      if (!canRun) {
        steps.push({
          name: 'logs',
          ok: true,
          skipped: true,
          requestSummary: 'skipped: missing log provider prerequisites',
        });
      } else {
        const result = await queryLogs(
          cfg,
          exec,
          {
            service,
            namespace,
            pod: alert?.pod,
            since: '1h',
            query: alert?.name,
          },
          fetchFn,
        );
        steps.push({
          name: 'logs',
          ok: true,
          requestSummary: result.requestSummary,
          outputs: { provider: result.provider, textLength: result.text.length },
        });
      }
    } catch (err) {
      steps.push(stepError('logs', err));
    }
  }

  // metrics
  if (skip.metrics) {
    steps.push({ name: 'metrics', ok: true, skipped: true });
  } else if (!cfg.metricsHttpUrl) {
    steps.push({
      name: 'metrics',
      ok: true,
      skipped: true,
      requestSummary: 'skipped: OPS_METRICS_HTTP_URL not set',
    });
  } else {
    try {
      const result = await queryMetrics(cfg, { service, namespace, query: alert?.name }, fetchFn);
      steps.push({
        name: 'metrics',
        ok: true,
        requestSummary: result.requestSummary,
        outputs: { textLength: result.text.length },
      });
    } catch (err) {
      steps.push(stepError('metrics', err));
    }
  }

  // k8s
  if (skip.k8s) {
    steps.push({ name: 'k8s', ok: true, skipped: true });
  } else {
    try {
      const pods = await getPods(cfg, exec, {
        namespace,
        labelSelector: service ? `app=${service}` : undefined,
      });
      const events = await getEvents(cfg, exec, { namespace });
      steps.push({
        name: 'k8s',
        ok: true,
        requestSummary: `${pods.requestSummary} ; ${events.requestSummary}`,
        outputs: { pods: pods.data, events: events.data },
      });
    } catch (err) {
      steps.push(stepError('k8s', err));
    }
  }

  // gitlab
  if (skip.gitlab) {
    steps.push({ name: 'gitlab', ok: true, skipped: true });
  } else if (!cfg.gitlabUrl || !cfg.gitlabToken || !cfg.gitlabProject) {
    steps.push({
      name: 'gitlab',
      ok: true,
      skipped: true,
      requestSummary: 'skipped: GitLab env not set',
    });
  } else {
    try {
      const gl = createGitlabClient(cfg, fetchFn);
      const outputs: Record<string, unknown> = { project: await gl.getProject() };
      if (ctx.gitlabSearch) outputs.search = await gl.searchCode(ctx.gitlabSearch);
      if (ctx.issue) {
        outputs.issue = await gl.createIssue({
          title: ctx.issue.title ?? `[ops] ${alert?.name ?? 'incident'}`,
          description:
            ctx.issue.description ??
            `Auto-filed from ops-pipeline.\n\n${alert?.summary ?? ''}\n${alert?.description ?? ''}`,
          labels: ctx.issue.labels ?? ['ops', 'incident'],
        });
      }
      if (ctx.mergeRequest) {
        outputs.mergeRequest = await gl.createMergeRequest({
          sourceBranch: ctx.mergeRequest.sourceBranch,
          targetBranch: ctx.mergeRequest.targetBranch ?? 'main',
          title: ctx.mergeRequest.title ?? `[ops] fix ${alert?.name ?? 'incident'}`,
          description: ctx.mergeRequest.description,
        });
      }
      steps.push({
        name: 'gitlab',
        ok: true,
        requestSummary: `GitLab project ${cfg.gitlabProject}`,
        outputs,
      });
    } catch (err) {
      steps.push(stepError('gitlab', err));
    }
  }

  // coding
  if (skip.coding) {
    steps.push({ name: 'coding', ok: true, skipped: true });
  } else if (!ctx.coding?.workspaceDir) {
    steps.push({
      name: 'coding',
      ok: true,
      skipped: true,
      requestSummary: 'skipped: no coding.workspaceDir',
    });
  } else {
    try {
      const ws = createCodingWorkspace(exec, ctx.coding.workspaceDir);
      const outputs: Record<string, unknown> = {};
      if (ctx.coding.repoUrl) {
        outputs.clone = await ws.cloneOrFetch(ctx.coding.repoUrl, { branch: ctx.coding.branch });
      }
      if (ctx.coding.branch) outputs.branch = await ws.createBranch(ctx.coding.branch);
      if (ctx.coding.patchFile) outputs.patch = await ws.applyPatchFile(ctx.coding.patchFile);
      if (ctx.coding.commitMessage) outputs.commit = await ws.commitAll(ctx.coding.commitMessage);
      outputs.status = await ws.status();
      steps.push({
        name: 'coding',
        ok: true,
        requestSummary: `coding workspace ${ctx.coding.workspaceDir}`,
        outputs,
      });
    } catch (err) {
      steps.push(stepError('coding', err));
    }
  }

  // image
  if (skip.image) {
    steps.push({ name: 'image', ok: true, skipped: true });
  } else if (!ctx.image) {
    steps.push({
      name: 'image',
      ok: true,
      skipped: true,
      requestSummary: 'skipped: no image opts',
    });
  } else {
    try {
      const result = await buildAndPushImage(cfg, exec, ctx.image);
      imageRef = result.imageRef;
      steps.push({
        name: 'image',
        ok: true,
        requestSummary: result.steps.map((s) => s.requestSummary).join(' ; '),
        outputs: { imageRef: result.imageRef },
      });
    } catch (err) {
      steps.push(stepError('image', err));
    }
  }

  // release
  if (skip.release) {
    steps.push({ name: 'release', ok: true, skipped: true });
  } else if (
    (cfg.releaseProvider === 'http' && !cfg.releaseWebhookUrl) ||
    (cfg.releaseProvider === 'script' && !cfg.releaseScript)
  ) {
    steps.push({
      name: 'release',
      ok: true,
      skipped: true,
      requestSummary: 'skipped: release provider config missing',
    });
  } else {
    try {
      const payload = {
        alert: alert
          ? { name: alert.name, fingerprint: alert.fingerprint, severity: alert.severity }
          : undefined,
        imageRef,
        ...(ctx.release?.payload ?? {}),
      };
      const result = await triggerRelease(cfg, exec, payload, fetchFn);
      steps.push({
        name: 'release',
        ok: true,
        requestSummary: result.requestSummary,
        outputs: { responseText: result.responseText.slice(0, 2000) },
      });
    } catch (err) {
      steps.push(stepError('release', err));
    }
  }

  // verify
  if (skip.verify) {
    steps.push({ name: 'verify', ok: true, skipped: true });
  } else if (!ctx.verify?.deployment) {
    steps.push({
      name: 'verify',
      ok: true,
      skipped: true,
      requestSummary: 'skipped: no verify.deployment',
    });
  } else {
    try {
      const result = await verifyRelease(cfg, exec, {
        deployment: ctx.verify.deployment,
        namespace: ctx.verify.namespace ?? namespace,
        timeout: ctx.verify.timeout,
        logQuery: service
          ? { service, namespace: ctx.verify.namespace ?? namespace, since: '10m' }
          : undefined,
      });
      steps.push({
        name: 'verify',
        ok: true,
        requestSummary: result.rollout.requestSummary,
        outputs: {
          rollout: result.rollout.text.slice(0, 2000),
          logs: result.logs
            ? { provider: result.logs.provider, textLength: result.logs.text.length }
            : undefined,
        },
      });
    } catch (err) {
      steps.push(stepError('verify', err));
    }
  }

  return {
    ok: steps.every((s) => s.ok),
    alert,
    steps,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
