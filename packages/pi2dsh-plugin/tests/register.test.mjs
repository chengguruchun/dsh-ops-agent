import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerOpsTools,
  expectedOpsToolNames,
  expectedCrToolNames,
  expectedAllToolNames,
  invokeOpsTool,
  invokeCrTool,
  createRuntime,
} from '../dist/index.js';
import { listOpsToolNames, loadOpsConfig } from '@dsh-ops-agent/ops-pipeline';
import { listCrToolNames, loadCodeReviewConfig } from '@dsh-ops-agent/code-review';

function createFakePi() {
  const tools = new Map();
  const events = [];
  return {
    api: {
      registerTool(tool) {
        tools.set(tool.name, tool);
      },
      on(event, handler) {
        events.push({ event, handler });
      },
    },
    tools,
    events,
  };
}

describe('registerOpsTools', () => {
  it('registers every OPS + CR catalog name by default', () => {
    const fake = createFakePi();
    const result = registerOpsTools(fake.api, { enableCompactionGuard: true });
    const expected = expectedAllToolNames();
    assert.deepEqual(result.toolNames.slice().sort(), expected.slice().sort());
    assert.deepEqual([...fake.tools.keys()].sort(), expected.slice().sort());
    assert.equal(result.compactionGuard, true);
    assert.equal(result.codeReview, true);
    assert.deepEqual(result.opsToolNames.slice().sort(), listOpsToolNames().slice().sort());
    assert.deepEqual(result.crToolNames.slice().sort(), listCrToolNames().slice().sort());
    assert.ok(fake.events.some((e) => e.event === 'session_before_compact'));
    for (const name of expected) {
      const tool = fake.tools.get(name);
      assert.ok(tool, `missing tool ${name}`);
      assert.equal(typeof tool.execute, 'function');
      assert.ok(tool.parameters, `missing parameters for ${name}`);
    }
  });

  it('expected*ToolNames match catalogs', () => {
    assert.deepEqual(expectedOpsToolNames(), listOpsToolNames());
    assert.deepEqual(expectedCrToolNames(), listCrToolNames());
  });

  it('can skip compaction guard and code-review', () => {
    const fake = createFakePi();
    const result = registerOpsTools(fake.api, {
      enableCompactionGuard: false,
      enableCodeReview: false,
    });
    assert.equal(result.compactionGuard, false);
    assert.equal(result.codeReview, false);
    assert.equal(result.crToolNames.length, 0);
    assert.equal(fake.events.length, 0);
    assert.deepEqual(result.toolNames.slice().sort(), listOpsToolNames().slice().sort());
  });
});

describe('invokeOpsTool handlers (offline DI)', () => {
  it('ops_normalize_alert uses real normalizeAlert', async () => {
    const runtime = createRuntime({
      config: loadOpsConfig({}),
      exec: async () => {
        throw new Error('exec should not run');
      },
    });
    const result = await invokeOpsTool(
      'ops_normalize_alert',
      {
        alert: {
          labels: { alertname: 'HighErrorRate', severity: 'critical', service: 'checkout' },
          annotations: { summary: 'errors up' },
          status: 'firing',
        },
      },
      runtime,
    );
    assert.match(result.content[0].text, /HighErrorRate/);
    assert.equal(result.details.name, 'HighErrorRate');
    assert.equal(result.details.service, 'checkout');
  });

  it('ops_k8s_get_pods invokes injected exec with kubectl argv', async () => {
    const calls = [];
    const runtime = createRuntime({
      config: loadOpsConfig({}),
      exec: async (req) => {
        calls.push(req);
        return {
          code: 0,
          stdout: JSON.stringify({ kind: 'PodList', items: [] }),
          stderr: '',
        };
      },
    });
    const result = await invokeOpsTool(
      'ops_k8s_get_pods',
      { namespace: 'prod', labelSelector: 'app=checkout' },
      runtime,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'kubectl');
    assert.ok(calls[0].args.includes('get'));
    assert.ok(calls[0].args.includes('pods'));
    assert.ok(calls[0].args.includes('prod'));
    assert.ok(calls[0].args.includes('app=checkout'));
    assert.match(result.content[0].text, /PodList/);
  });

  it('ops_run_closed_loop skips unconfigured stages offline', async () => {
    const runtime = createRuntime({
      config: loadOpsConfig({}),
      exec: async () => {
        throw new Error('exec should not run when k8s/logs skipped');
      },
    });
    const result = await invokeOpsTool(
      'ops_run_closed_loop',
      {
        alert: {
          labels: { alertname: 'T', severity: 'info', service: 'svc' },
          annotations: { summary: 's' },
          status: 'firing',
        },
        skip: { k8s: true, logs: true },
      },
      runtime,
    );
    const report = result.details;
    assert.equal(report.ok, true);
    assert.equal(report.alert.name, 'T');
  });

  it('unknown tool returns error result', async () => {
    const runtime = createRuntime({ config: loadOpsConfig({}) });
    const result = await invokeOpsTool('ops_not_a_tool', {}, runtime);
    assert.match(result.content[0].text, /Unknown ops tool/);
  });
});

describe('invokeCrTool handlers (offline DI)', () => {
  it('cr_heuristic_review runs offline without exec', async () => {
    const runtime = createRuntime({
      crConfig: loadCodeReviewConfig({ CR_HUGE_DIFF_LINES: '10' }),
      exec: async () => {
        throw new Error('exec should not run');
      },
    });
    const result = await invokeCrTool(
      'cr_heuristic_review',
      {
        files: [{ path: 'src/a.ts' }],
        diffText: Array.from({ length: 12 }, (_, i) => `+line ${i}`).join('\n'),
      },
      runtime,
    );
    assert.equal(result.details.ok, true);
    assert.ok(result.details.findings.some((f) => f.code === 'huge_diff'));
    assert.ok(result.details.findings.some((f) => f.code === 'missing_tests'));
  });

  it('cr_fetch_pr invokes injected gh exec', async () => {
    const calls = [];
    const runtime = createRuntime({
      crConfig: loadCodeReviewConfig({ GH_TOKEN: 'tok', CR_REPO: 'acme/app' }),
      exec: async (req) => {
        calls.push(req);
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 5,
            title: 'Hello',
            body: '',
            author: { login: 'u' },
            url: 'https://example/pr/5',
            baseRefName: 'main',
            headRefName: 'feat',
            state: 'OPEN',
          }),
          stderr: '',
        };
      },
    });
    const result = await invokeCrTool('cr_fetch_pr', { number: 5 }, runtime);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'gh');
    assert.ok(calls[0].args.includes('view'));
    assert.equal(result.details.pr.title, 'Hello');
  });
});

describe('compaction guard hook', () => {
  it('vetoes threshold compact when ops hints present and slightly over floor', async () => {
    const fake = createFakePi();
    registerOpsTools(fake.api, {
      enableCompactionGuard: true,
      preserveHints: ['incident-id', 'alert-rule'],
      pressureFloor: 1000,
    });
    const handler = fake.events.find((e) => e.event === 'session_before_compact')?.handler;
    assert.ok(handler);
    const out = await handler({
      type: 'session_before_compact',
      reason: 'threshold',
      preparation: { estimatedTokens: 1500, pressureFloor: 1000 },
    });
    assert.equal(out?.cancel, true);
  });
});
