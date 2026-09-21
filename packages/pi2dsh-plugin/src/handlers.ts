/**
 * Real handlers for OPS_TOOL_CATALOG — call ops-pipeline stages / AgentLoop.
 * DI via OpsToolRuntime (exec / config / fetch) keeps unit tests offline.
 */

import {
  buildAndPushImage,
  createCodingWorkspace,
  createGitlabClient,
  discover,
  getEvents,
  getPods,
  normalizeAlert,
  queryLogs,
  queryMetrics,
  rolloutStatus,
  runAgentLoop,
  runOpsClosedLoop,
  selfReview,
  triggerRelease,
  verifyRelease,
} from '@dsh-ops-agent/ops-pipeline';
import type { OpsToolRuntime } from './deps.js';
import { toolErrorResult, toolTextResult, type PiToolResult } from './pi-abi.js';

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}

export type OpsToolHandler = (
  params: Record<string, unknown>,
  runtime: OpsToolRuntime,
) => Promise<PiToolResult>;

export const OPS_TOOL_HANDLERS: Record<string, OpsToolHandler> = {
  async ops_normalize_alert(params) {
    const alert = params.alert;
    if (alert == null) throw new Error('ops_normalize_alert requires alert');
    return toolTextResult(normalizeAlert(alert));
  },

  async ops_query_logs(params, runtime) {
    const result = await queryLogs(
      runtime.getConfig(),
      runtime.exec,
      {
        service: asString(params.service),
        namespace: asString(params.namespace),
        since: asString(params.since),
        query: asString(params.query),
        pod: asString(params.pod),
      },
      runtime.fetchFn,
    );
    return toolTextResult(result);
  },

  async ops_query_metrics(params, runtime) {
    const result = await queryMetrics(
      runtime.getConfig(),
      {
        query: asString(params.query),
        service: asString(params.service),
        namespace: asString(params.namespace),
      },
      runtime.fetchFn,
    );
    return toolTextResult(result);
  },

  async ops_k8s_get_pods(params, runtime) {
    const result = await getPods(runtime.getConfig(), runtime.exec, {
      namespace: asString(params.namespace),
      labelSelector: asString(params.labelSelector),
    });
    return toolTextResult(result);
  },

  async ops_k8s_get_events(params, runtime) {
    const result = await getEvents(runtime.getConfig(), runtime.exec, {
      namespace: asString(params.namespace),
    });
    return toolTextResult(result);
  },

  async ops_k8s_rollout_status(params, runtime) {
    const name = asString(params.name);
    if (!name) throw new Error('ops_k8s_rollout_status requires name');
    const result = await rolloutStatus(runtime.getConfig(), runtime.exec, {
      name,
      namespace: asString(params.namespace),
      timeout: asString(params.timeout),
    });
    return toolTextResult(result);
  },

  async ops_gitlab_search_code(params, runtime) {
    const query = asString(params.query);
    if (!query) throw new Error('ops_gitlab_search_code requires query');
    const client = createGitlabClient(runtime.getConfig(), runtime.fetchFn);
    const result = await client.searchCode(query, { perPage: asNumber(params.perPage) });
    return toolTextResult(result);
  },

  async ops_gitlab_create_issue(params, runtime) {
    const title = asString(params.title);
    if (!title) throw new Error('ops_gitlab_create_issue requires title');
    const client = createGitlabClient(runtime.getConfig(), runtime.fetchFn);
    const result = await client.createIssue({
      title,
      description: asString(params.description),
      labels: asStringArray(params.labels),
    });
    return toolTextResult(result);
  },

  async ops_gitlab_create_mr(params, runtime) {
    const sourceBranch = asString(params.sourceBranch);
    const title = asString(params.title);
    if (!sourceBranch || !title) {
      throw new Error('ops_gitlab_create_mr requires sourceBranch and title');
    }
    const client = createGitlabClient(runtime.getConfig(), runtime.fetchFn);
    const result = await client.createMergeRequest({
      sourceBranch,
      targetBranch: asString(params.targetBranch) ?? 'main',
      title,
      description: asString(params.description),
    });
    return toolTextResult(result);
  },

  async ops_coding_apply_patch(params, runtime) {
    const workspaceDir = asString(params.workspaceDir);
    const patchFile = asString(params.patchFile);
    if (!workspaceDir || !patchFile) {
      throw new Error('ops_coding_apply_patch requires workspaceDir and patchFile');
    }
    const ws = createCodingWorkspace(runtime.exec, workspaceDir);
    const result = await ws.applyPatchFile(patchFile);
    return toolTextResult(result);
  },

  async ops_docker_build_push(params, runtime) {
    const contextDir = asString(params.contextDir);
    const imageName = asString(params.imageName);
    const tag = asString(params.tag);
    if (!contextDir || !imageName || !tag) {
      throw new Error('ops_docker_build_push requires contextDir, imageName, tag');
    }
    const result = await buildAndPushImage(runtime.getConfig(), runtime.exec, {
      contextDir,
      dockerfile: asString(params.dockerfile),
      imageName,
      tag,
      fullRef: asString(params.fullRef),
      login: asBool(params.login),
    });
    return toolTextResult(result);
  },

  async ops_trigger_release(params, runtime) {
    const payload = asRecord(params.payload);
    const result = await triggerRelease(
      runtime.getConfig(),
      runtime.exec,
      payload,
      runtime.fetchFn,
    );
    return toolTextResult(result);
  },

  async ops_verify_release(params, runtime) {
    const deployment = asString(params.deployment);
    if (!deployment) throw new Error('ops_verify_release requires deployment');
    const service = asString(params.service);
    const namespace = asString(params.namespace);
    const result = await verifyRelease(runtime.getConfig(), runtime.exec, {
      deployment,
      namespace,
      timeout: asString(params.timeout),
      logQuery: service ? { service, namespace } : undefined,
    });
    return toolTextResult(result);
  },

  async ops_run_closed_loop(params, runtime) {
    if (params.alert == null) throw new Error('ops_run_closed_loop requires alert');
    const skip = params.skip != null ? (asRecord(params.skip) as never) : undefined;
    const verify = params.verify != null ? (asRecord(params.verify) as never) : undefined;
    const image = params.image != null ? (asRecord(params.image) as never) : undefined;
    const coding = params.coding != null ? (asRecord(params.coding) as never) : undefined;
    const report = await runOpsClosedLoop({
      alert: params.alert,
      config: runtime.getConfig(),
      exec: runtime.exec,
      fetchFn: runtime.fetchFn,
      skip,
      verify,
      image,
      coding,
    });
    return toolTextResult(report);
  },

  async ops_agent_loop_start(params, runtime) {
    if (params.alert == null) throw new Error('ops_agent_loop_start requires alert');
    const coding = asRecord(params.coding);
    const patchFile = asString(params.patchFile) ?? asString(coding.patchFile);
    const patchContent = asString(params.patchContent) ?? asString(coding.patchContent);
    const result = await runAgentLoop({
      alert: params.alert,
      runId: asString(params.runId),
      config: runtime.getConfig(),
      exec: runtime.exec,
      fetchFn: runtime.fetchFn,
      checkpointDir: asString(params.checkpointDir),
      coding: Object.keys(coding).length
        ? {
            workspaceDir: asString(coding.workspaceDir) ?? '',
            repoUrl: asString(coding.repoUrl),
            branch: asString(coding.branch),
            patchFile,
            patchContent,
            commitMessage: asString(coding.commitMessage),
          }
        : patchFile || patchContent
          ? {
              workspaceDir: asString(params.workspaceDir) ?? '/tmp/ops-workspace',
              patchFile,
              patchContent,
            }
          : undefined,
      image: params.image != null ? (asRecord(params.image) as never) : undefined,
      verify: params.verify != null ? (asRecord(params.verify) as never) : undefined,
    });
    return toolTextResult(result);
  },

  async ops_agent_loop_resume(params, runtime) {
    const runId = asString(params.runId);
    if (!runId) throw new Error('ops_agent_loop_resume requires runId');
    if (params.alert == null) throw new Error('ops_agent_loop_resume requires alert');
    const coding = asRecord(params.coding);
    const result = await runAgentLoop({
      alert: params.alert,
      runId,
      resumeFrom: true,
      config: runtime.getConfig(),
      exec: runtime.exec,
      fetchFn: runtime.fetchFn,
      checkpointDir: asString(params.checkpointDir),
      coding: Object.keys(coding).length
        ? {
            workspaceDir: asString(coding.workspaceDir) ?? '',
            repoUrl: asString(coding.repoUrl),
            branch: asString(coding.branch),
            patchFile: asString(coding.patchFile),
            patchContent: asString(coding.patchContent),
            commitMessage: asString(coding.commitMessage),
          }
        : undefined,
      image: params.image != null ? (asRecord(params.image) as never) : undefined,
      verify: params.verify != null ? (asRecord(params.verify) as never) : undefined,
    });
    return toolTextResult(result);
  },

  async ops_self_review(params, runtime) {
    const workspaceDir = asString(params.workspaceDir);
    if (!workspaceDir) throw new Error('ops_self_review requires workspaceDir');
    const result = await selfReview({
      workspaceDir,
      exec: runtime.exec,
      reviewCommand: asString(params.reviewCommand),
      allowEmptyDiff: asBool(params.allowEmptyDiff),
    });
    return toolTextResult(result);
  },

  async ops_discover(params, runtime) {
    if (params.alert == null) throw new Error('ops_discover requires alert');
    const result = await discover({
      alert: params.alert,
      config: runtime.getConfig(),
      exec: runtime.exec,
      fetchFn: runtime.fetchFn,
      gitlabSearch: asString(params.gitlabSearch),
      skipLogs: asBool(params.skipLogs),
      skipK8s: asBool(params.skipK8s),
    });
    return toolTextResult(result);
  },
};

export async function invokeOpsTool(
  name: string,
  params: Record<string, unknown>,
  runtime: OpsToolRuntime,
): Promise<PiToolResult> {
  const handler = OPS_TOOL_HANDLERS[name];
  if (!handler) {
    return toolErrorResult(new Error(`Unknown ops tool: ${name}`));
  }
  try {
    return await handler(params, runtime);
  } catch (err) {
    return toolErrorResult(err);
  }
}
