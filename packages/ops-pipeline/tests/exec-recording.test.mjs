import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPods, getEvents, rolloutStatus } from '../dist/stages/k8s.js';
import { buildAndPushImage, dockerLogin } from '../dist/stages/image.js';
import { createCodingWorkspace } from '../dist/stages/coding.js';
import { queryLogs } from '../dist/stages/logs.js';
import { loadOpsConfig } from '../dist/config.js';

function recordingExec(handler) {
  const calls = [];
  const exec = async (req) => {
    calls.push({
      cmd: req.cmd,
      args: [...(req.args ?? [])],
      cwd: req.cwd,
      stdin: req.stdin,
      env: req.env,
    });
    return handler(req, calls);
  };
  exec.calls = calls;
  return exec;
}

describe('kubectl argv (DI exec)', () => {
  const cfg = loadOpsConfig({
    OPS_KUBECONFIG: '/tmp/kubeconfig',
    OPS_KUBE_CONTEXT: 'dev',
  });

  it('getPods builds expected argv', async () => {
    const exec = recordingExec(async () => ({
      code: 0,
      stdout: JSON.stringify({ kind: 'PodList', items: [] }),
      stderr: '',
    }));
    await getPods(cfg, exec, { namespace: 'prod', labelSelector: 'app=checkout' });
    const c = exec.calls[0];
    assert.equal(c.cmd, 'kubectl');
    assert.deepEqual(c.args, [
      'get', 'pods', '-n', 'prod', '-l', 'app=checkout',
      '--context', 'dev', '-o', 'json',
    ]);
    assert.equal(c.env.KUBECONFIG, '/tmp/kubeconfig');
  });

  it('getEvents and rolloutStatus argv', async () => {
    const exec = recordingExec(async (req) => {
      if (req.args.includes('events')) {
        return { code: 0, stdout: '{"items":[]}', stderr: '' };
      }
      return { code: 0, stdout: 'deployment "x" successfully rolled out\n', stderr: '' };
    });
    await getEvents(cfg, exec, { namespace: 'prod' });
    await rolloutStatus(cfg, exec, { name: 'checkout', namespace: 'prod', timeout: '60s' });
    assert.ok(exec.calls[0].args.includes('events'));
    assert.deepEqual(exec.calls[1].args.slice(0, 3), [
      'rollout', 'status', 'deployment/checkout',
    ]);
    assert.ok(exec.calls[1].args.includes('--timeout=60s'));
    assert.ok(exec.calls[1].args.includes('-n'));
  });
});

describe('docker argv (DI exec)', () => {
  const cfg = loadOpsConfig({
    OPS_DOCKER_REGISTRY: 'registry.example',
    OPS_DOCKER_NAMESPACE: 'ns',
    OPS_DOCKER_USERNAME: 'u',
    OPS_DOCKER_PASSWORD: 'p@ss',
  });

  it('login uses password-stdin and does not put password in args', async () => {
    const exec = recordingExec(async () => ({ code: 0, stdout: 'Login Succeeded\n', stderr: '' }));
    await dockerLogin(cfg, exec);
    const c = exec.calls[0];
    assert.equal(c.cmd, 'docker');
    assert.ok(c.args.includes('--password-stdin'));
    assert.ok(!JSON.stringify(c.args).includes('p@ss'));
    assert.equal(c.stdin, 'p@ss');
  });

  it('build/push argv (tags full ref in build)', async () => {
    const exec = recordingExec(async () => ({ code: 0, stdout: '', stderr: '' }));
    const result = await buildAndPushImage(cfg, exec, {
      contextDir: '.',
      imageName: 'checkout',
      tag: '1.2.3',
      dockerfile: 'Dockerfile',
    });
    assert.equal(result.imageRef, 'registry.example/ns/checkout:1.2.3');
    const cmds = exec.calls.map((c) => [c.cmd, ...c.args].join(' '));
    assert.ok(cmds.some((c) => c.includes('docker build') && c.includes('-t registry.example/ns/checkout:1.2.3')));
    assert.ok(!cmds.some((c) => c.startsWith('docker tag')));
    assert.ok(cmds.some((c) => c === 'docker push registry.example/ns/checkout:1.2.3'));
  });
});

describe('coding git argv (DI exec)', () => {
  it('createBranch / applyPatchFile / commitAll', async () => {
    const exec = recordingExec(async (req) => {
      if (req.args?.[0] === 'rev-parse') {
        return { code: 0, stdout: 'true\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });
    const ws = createCodingWorkspace(exec, '/tmp/ws-fake');
    await ws.createBranch('fix/ops');
    await ws.applyPatchFile('/tmp/fix.patch');
    await ws.commitAll('fix: ops');
    const joined = exec.calls.map((c) => (c.args ?? []).join(' '));
    assert.ok(joined.some((a) => a.startsWith('checkout -B fix/ops')));
    assert.ok(joined.some((a) => a === 'apply --index /tmp/fix.patch'));
    assert.ok(joined.some((a) => a === 'commit -m fix: ops'));
  });
});

describe('kubectl logs argv', () => {
  it('uses label selector for service', async () => {
    const cfg = loadOpsConfig({ OPS_LOG_PROVIDER: 'kubectl' });
    const exec = recordingExec(async () => ({ code: 0, stdout: 'line\n', stderr: '' }));
    const r = await queryLogs(cfg, exec, { service: 'api', namespace: 'prod', since: '30m' });
    assert.equal(r.provider, 'kubectl');
    assert.equal(exec.calls[0].cmd, 'kubectl');
    assert.ok(exec.calls[0].args.includes('logs'));
    assert.ok(exec.calls[0].args.includes('-n'));
    assert.ok(exec.calls[0].args.includes('prod'));
    assert.ok(exec.calls[0].args.includes('--since=30m'));
    assert.ok(exec.calls[0].args.includes('-l'));
    assert.ok(exec.calls[0].args.includes('app=api'));
  });
});
