/**
 * Pi / DSH-oriented tool descriptors for later pi2dsh registration.
 * Pure data + thin wrappers — no Cordis coupling here.
 */

export type JsonSchema = Record<string, unknown>;

export type OpsToolDescriptor = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

export const OPS_TOOL_CATALOG: OpsToolDescriptor[] = [
  {
    name: 'ops_docker_pull',
    description: 'docker pull an image ref from the registry',
    parameters: {
      type: 'object',
      properties: {
        imageRef: { type: 'string' },
        login: { type: 'boolean' },
      },
      required: ['imageRef'],
    },
  },
  {
    name: 'ops_helm_upgrade',
    description: 'helm upgrade --install a chart (optionally set image.repository/tag from imageRef)',
    parameters: {
      type: 'object',
      properties: {
        releaseName: { type: 'string' },
        chart: { type: 'string' },
        namespace: { type: 'string' },
        imageRef: { type: 'string' },
        valuesFiles: { type: 'array', items: { type: 'string' } },
        set: { type: 'object' },
        timeout: { type: 'string' },
        atomic: { type: 'boolean' },
      },
      required: ['releaseName', 'chart'],
    },
  },
  {
    name: 'ops_helm_rollback',
    description: 'helm rollback a release to a previous revision',
    parameters: {
      type: 'object',
      properties: {
        releaseName: { type: 'string' },
        namespace: { type: 'string' },
        revision: { type: 'number' },
      },
      required: ['releaseName'],
    },
  },

  {
    name: 'ops_normalize_alert',
    description: 'Normalize Alertmanager / webhook JSON into a NormalizedAlert',
    parameters: {
      type: 'object',
      properties: { alert: { type: 'object', description: 'Raw alert webhook payload' } },
      required: ['alert'],
    },
  },
  {
    name: 'ops_query_logs',
    description: 'Query logs via kubectl, Loki, or HTTP (OPS_LOG_PROVIDER)',
    parameters: {
      type: 'object',
      properties: {
        service: { type: 'string' },
        namespace: { type: 'string' },
        since: { type: 'string' },
        query: { type: 'string' },
        pod: { type: 'string' },
      },
    },
  },
  {
    name: 'ops_query_metrics',
    description: 'Query metrics via OPS_METRICS_HTTP_URL',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        service: { type: 'string' },
        namespace: { type: 'string' },
      },
    },
  },
  {
    name: 'ops_k8s_get_pods',
    description: 'kubectl get pods -o json',
    parameters: {
      type: 'object',
      properties: {
        namespace: { type: 'string' },
        labelSelector: { type: 'string' },
      },
    },
  },
  {
    name: 'ops_k8s_get_events',
    description: 'kubectl get events -o json',
    parameters: {
      type: 'object',
      properties: { namespace: { type: 'string' } },
    },
  },
  {
    name: 'ops_k8s_rollout_status',
    description: 'kubectl rollout status deployment/<name>',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        namespace: { type: 'string' },
        timeout: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'ops_gitlab_search_code',
    description: 'GitLab project code search API',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, perPage: { type: 'number' } },
      required: ['query'],
    },
  },
  {
    name: 'ops_gitlab_create_issue',
    description: 'Create a GitLab issue',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
      },
      required: ['title'],
    },
  },
  {
    name: 'ops_gitlab_create_mr',
    description: 'Create a GitLab merge request',
    parameters: {
      type: 'object',
      properties: {
        sourceBranch: { type: 'string' },
        targetBranch: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['sourceBranch', 'title'],
    },
  },
  {
    name: 'ops_coding_apply_patch',
    description: 'Apply a unified diff via git apply in a workspace',
    parameters: {
      type: 'object',
      properties: {
        workspaceDir: { type: 'string' },
        patchFile: { type: 'string' },
      },
      required: ['workspaceDir', 'patchFile'],
    },
  },
  {
    name: 'ops_docker_build_push',
    description: 'docker build + tag + push (password via stdin when login)',
    parameters: {
      type: 'object',
      properties: {
        contextDir: { type: 'string' },
        dockerfile: { type: 'string' },
        imageName: { type: 'string' },
        tag: { type: 'string' },
        fullRef: { type: 'string' },
        login: { type: 'boolean' },
      },
      required: ['contextDir', 'imageName', 'tag'],
    },
  },
  {
    name: 'ops_trigger_release',
    description: 'POST release webhook or run OPS_RELEASE_SCRIPT',
    parameters: {
      type: 'object',
      properties: { payload: { type: 'object' } },
    },
  },
  {
    name: 'ops_verify_release',
    description: 'kubectl rollout status + optional log re-query',
    parameters: {
      type: 'object',
      properties: {
        deployment: { type: 'string' },
        namespace: { type: 'string' },
        timeout: { type: 'string' },
        service: { type: 'string' },
      },
      required: ['deployment'],
    },
  },
  {
    name: 'ops_run_closed_loop',
    description: 'Run the full alert→…→verify closed loop with skippable steps',
    parameters: {
      type: 'object',
      properties: {
        alert: { type: 'object' },
        skip: { type: 'object' },
        verify: { type: 'object' },
        image: { type: 'object' },
        coding: { type: 'object' },
      },
      required: ['alert'],
    },
  },
  {
    name: 'ops_agent_loop_start',
    description:
      'Start autonomous AgentLoop: discover→diagnose→fix→review→release→verify with retry/checkpoint/circuit-breaker',
    parameters: {
      type: 'object',
      properties: {
        alert: { type: 'object' },
        runId: { type: 'string' },
        coding: { type: 'object' },
        image: { type: 'object' },
        verify: { type: 'object' },
        patchFile: { type: 'string' },
        patchContent: { type: 'string' },
        checkpointDir: { type: 'string' },
      },
      required: ['alert'],
    },
  },
  {
    name: 'ops_agent_loop_resume',
    description: 'Resume AgentLoop from a checkpoint runId under .ops-checkpoints/',
    parameters: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        alert: { type: 'object', description: 'Same alert context as the original run' },
        checkpointDir: { type: 'string' },
        coding: { type: 'object' },
        image: { type: 'object' },
        verify: { type: 'object' },
      },
      required: ['runId', 'alert'],
    },
  },
  {
    name: 'ops_self_review',
    description:
      'Self-review git diff/status for secrets and optional OPS_REVIEW_COMMAND; blockers hard-stop release',
    parameters: {
      type: 'object',
      properties: {
        workspaceDir: { type: 'string' },
        reviewCommand: { type: 'string' },
        allowEmptyDiff: { type: 'boolean' },
      },
      required: ['workspaceDir'],
    },
  },
  {
    name: 'ops_discover',
    description:
      'Synthesize DiscoveryReport from alert + logs + k8s pods/events (+ optional GitLab search)',
    parameters: {
      type: 'object',
      properties: {
        alert: { type: 'object' },
        gitlabSearch: { type: 'string' },
        skipLogs: { type: 'boolean' },
        skipK8s: { type: 'boolean' },
      },
      required: ['alert'],
    },
  },
];

export function listOpsToolNames(): string[] {
  return OPS_TOOL_CATALOG.map((t) => t.name);
}
