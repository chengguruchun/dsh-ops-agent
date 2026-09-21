import type { OpsConfig } from '../config.js';
import { requireGitlab } from '../config.js';

export type FetchFn = typeof fetch;

export type GitlabClient = {
  getProject: () => Promise<unknown>;
  listPipelines: (opts?: { ref?: string; perPage?: number }) => Promise<unknown>;
  listJobs: (pipelineId: number | string) => Promise<unknown>;
  getFile: (filePath: string, ref?: string) => Promise<{ content: string; encoding: string; raw: unknown }>;
  createIssue: (opts: { title: string; description?: string; labels?: string[] }) => Promise<unknown>;
  createMergeRequest: (opts: {
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description?: string;
  }) => Promise<unknown>;
  searchCode: (query: string, opts?: { perPage?: number }) => Promise<unknown>;
};

export function createGitlabClient(cfg: OpsConfig, fetchFn: FetchFn = fetch): GitlabClient {
  const { gitlabUrl, gitlabToken, gitlabProject } = requireGitlab(cfg);
  const projectEnc = encodeURIComponent(gitlabProject);

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${gitlabUrl}/api/v4${path}`;
    const headers: Record<string, string> = {
      'PRIVATE-TOKEN': gitlabToken,
      Accept: 'application/json',
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetchFn(url, { method, headers, body: payload });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }
    if (!res.ok) {
      throw new Error(`GitLab ${method} ${path} HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    return json;
  }

  return {
    getProject: () => request('GET', `/projects/${projectEnc}`),
    listPipelines: (opts = {}) => {
      const qs = new URLSearchParams();
      if (opts.ref) qs.set('ref', opts.ref);
      qs.set('per_page', String(opts.perPage ?? 20));
      return request('GET', `/projects/${projectEnc}/pipelines?${qs}`);
    },
    listJobs: (pipelineId) =>
      request('GET', `/projects/${projectEnc}/pipelines/${pipelineId}/jobs`),
    async getFile(filePath, ref = 'main') {
      const enc = encodeURIComponent(filePath);
      const raw = (await request(
        'GET',
        `/projects/${projectEnc}/repository/files/${enc}?ref=${encodeURIComponent(ref)}`,
      )) as Record<string, unknown>;
      const encoding = String(raw.encoding ?? 'base64');
      const contentB64 = String(raw.content ?? '');
      const content =
        encoding === 'base64' ? Buffer.from(contentB64, 'base64').toString('utf8') : contentB64;
      return { content, encoding, raw };
    },
    createIssue: (opts) =>
      request('POST', `/projects/${projectEnc}/issues`, {
        title: opts.title,
        description: opts.description ?? '',
        labels: opts.labels?.join(','),
      }),
    createMergeRequest: (opts) =>
      request('POST', `/projects/${projectEnc}/merge_requests`, {
        source_branch: opts.sourceBranch,
        target_branch: opts.targetBranch,
        title: opts.title,
        description: opts.description ?? '',
      }),
    searchCode: (query, opts = {}) => {
      const qs = new URLSearchParams({
        scope: 'blobs',
        search: query,
        per_page: String(opts.perPage ?? 20),
      });
      return request('GET', `/projects/${projectEnc}/search?${qs}`);
    },
  };
}
