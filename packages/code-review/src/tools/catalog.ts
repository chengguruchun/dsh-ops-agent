/**
 * Pi / DSH-oriented tool descriptors for the code-review sibling domain.
 * Registered via @dsh-ops-agent/pi2dsh-plugin alongside OPS_TOOL_CATALOG.
 * Pure data here — no Cordis coupling.
 */

export type JsonSchema = Record<string, unknown>;

export type CrToolDescriptor = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

export const CR_TOOL_CATALOG: CrToolDescriptor[] = [
  {
    name: 'cr_fetch_pr',
    description: 'Fetch a GitHub PR (gh) or GitLab MR (glab) metadata as JSON',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'PR or MR number / iid' },
        repo: { type: 'string', description: 'owner/repo override (CR_REPO)' },
        cwd: { type: 'string' },
      },
      required: ['number'],
    },
  },
  {
    name: 'cr_list_files',
    description: 'List changed files (and optionally capture unified diff) for a PR/MR',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'number' },
        repo: { type: 'string' },
        cwd: { type: 'string' },
      },
      required: ['number'],
    },
  },
  {
    name: 'cr_heuristic_review',
    description:
      'Heuristic review: secrets, huge diff, missing tests, TODO density (no LLM)',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'Optional; used only for report context' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, status: { type: 'string' } },
          },
        },
        diffText: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
  },
  {
    name: 'cr_run_checks',
    description: 'Run CR_REVIEW_COMMAND (lint/test) in cwd; records exit code',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        reviewCommand: { type: 'string' },
      },
    },
  },
  {
    name: 'cr_post_comment',
    description: 'Post a review comment (gh pr comment / glab mr note)',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'number' },
        body: { type: 'string' },
        repo: { type: 'string' },
        cwd: { type: 'string' },
      },
      required: ['number', 'body'],
    },
  },
  {
    name: 'cr_review_loop_start',
    description:
      'Run CodeReviewLoop: fetch → analyze → optional static → summarize → optional publish. Accepts llmSummary/reviewNotes from DSH host. Set resumeFrom/runId to resume.',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'number' },
        repo: { type: 'string' },
        cwd: { type: 'string' },
        runId: { type: 'string' },
        resumeFrom: { type: ['boolean', 'string'] },
        checkpointDir: { type: 'string' },
        runStatic: { type: 'boolean' },
        publish: { type: 'boolean' },
        llmSummary: { type: 'string', description: 'Host LLM narrative to embed in summary' },
        reviewNotes: { type: 'array', items: { type: 'string' } },
        reviewCommand: { type: 'string' },
        skip: { type: 'object' },
      },
      required: ['number'],
    },
  },
];

export function listCrToolNames(): string[] {
  return CR_TOOL_CATALOG.map((t) => t.name);
}
