/**
 * Handlers for CR_TOOL_CATALOG — sibling code-review domain.
 * DI via OpsToolRuntime (exec / crConfig) keeps unit tests offline.
 */

import {
  fetchPr,
  heuristicReview,
  listChangedFiles,
  postReviewComment,
  runCodeReviewLoop,
  runStaticChecks,
} from '@dsh-ops-agent/code-review';
import type { OpsToolRuntime } from './deps.js';
import { toolErrorResult, toolTextResult, type PiToolResult } from './pi-abi.js';

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

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export type CrToolHandler = (
  params: Record<string, unknown>,
  runtime: OpsToolRuntime,
) => Promise<PiToolResult>;

export const CR_TOOL_HANDLERS: Record<string, CrToolHandler> = {
  async cr_fetch_pr(params, runtime) {
    const number = asNumber(params.number);
    if (number == null) throw new Error('cr_fetch_pr requires number');
    const result = await fetchPr(runtime.getCrConfig(), runtime.exec, {
      number,
      repo: asString(params.repo),
      cwd: asString(params.cwd),
    });
    return toolTextResult(result);
  },

  async cr_list_files(params, runtime) {
    const number = asNumber(params.number);
    if (number == null) throw new Error('cr_list_files requires number');
    const result = await listChangedFiles(runtime.getCrConfig(), runtime.exec, {
      number,
      repo: asString(params.repo),
      cwd: asString(params.cwd),
    });
    return toolTextResult(result);
  },

  async cr_heuristic_review(params, runtime) {
    const filesRaw = Array.isArray(params.files) ? params.files : [];
    const files: { path: string; status?: string }[] = [];
    for (const f of filesRaw) {
      const r = asRecord(f);
      const path = asString(r.path);
      if (!path) continue;
      const status = asString(r.status);
      files.push(status ? { path, status } : { path });
    }
    const number = asNumber(params.number);
    const result = heuristicReview(runtime.getCrConfig(), {
      pr:
        number != null || asString(params.title) || asString(params.body)
          ? {
              provider: runtime.getCrConfig().provider,
              number: number ?? 0,
              title: asString(params.title) ?? '',
              body: asString(params.body) ?? '',
            }
          : undefined,
      files,
      diffText: asString(params.diffText),
    });
    return toolTextResult(result);
  },

  async cr_run_checks(params, runtime) {
    const result = await runStaticChecks(runtime.getCrConfig(), runtime.exec, {
      cwd: asString(params.cwd),
      reviewCommand: asString(params.reviewCommand),
    });
    return toolTextResult(result);
  },

  async cr_post_comment(params, runtime) {
    const number = asNumber(params.number);
    const body = asString(params.body);
    if (number == null || !body) {
      throw new Error('cr_post_comment requires number and body');
    }
    const result = await postReviewComment(runtime.getCrConfig(), runtime.exec, {
      number,
      body,
      repo: asString(params.repo),
      cwd: asString(params.cwd),
    });
    return toolTextResult(result);
  },

  async cr_review_loop_start(params, runtime) {
    const number = asNumber(params.number);
    if (number == null) throw new Error('cr_review_loop_start requires number');
    const resumeFrom = params.resumeFrom;
    const result = await runCodeReviewLoop({
      number,
      repo: asString(params.repo),
      cwd: asString(params.cwd),
      runId: asString(params.runId),
      resumeFrom:
        typeof resumeFrom === 'boolean' || typeof resumeFrom === 'string'
          ? resumeFrom
          : undefined,
      checkpointDir: asString(params.checkpointDir),
      runStatic: asBool(params.runStatic),
      publish: asBool(params.publish),
      llmSummary: asString(params.llmSummary),
      reviewNotes: asStringArray(params.reviewNotes),
      reviewCommand: asString(params.reviewCommand),
      skip: params.skip != null ? (asRecord(params.skip) as never) : undefined,
      config: runtime.getCrConfig(),
      exec: runtime.exec,
    });
    return toolTextResult(result);
  },
};

export async function invokeCrTool(
  name: string,
  params: Record<string, unknown>,
  runtime: OpsToolRuntime,
): Promise<PiToolResult> {
  const handler = CR_TOOL_HANDLERS[name];
  if (!handler) {
    return toolErrorResult(new Error(`Unknown cr tool: ${name}`));
  }
  try {
    return await handler(params, runtime);
  } catch (err) {
    return toolErrorResult(err);
  }
}
