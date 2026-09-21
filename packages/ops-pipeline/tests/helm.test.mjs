import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadOpsConfig } from '../dist/config.js';
import { dockerPull } from '../dist/stages/image.js';
import { helmUpgradeInstall, helmRollback } from '../dist/stages/helm.js';
import { triggerRelease } from '../dist/stages/release.js';

function recordingExec(handler) {
  const calls = [];
  const exec = async (req) => {
    calls.push({ cmd: req.cmd, args: [...(req.args ?? [])], env: req.env, stdin: req.stdin });
    return handler(req, calls);
  };
  exec.calls = calls;
  return exec;
}

describe('dockerPull', () => {
  it('builds docker pull argv', async () => {
    const cfg = loadOpsConfig({});
    const exec = recordingExec(async () => ({ code: 0, stdout: 'Pulled\n', stderr: '' }));
    await dockerPull(cfg, exec, { imageRef: 'registry.example/ns/app:1.2.3' });
    assert.deepEqual(exec.calls[0].args, ['pull', 'registry.example/ns/app:1.2.3']);
  });
});

describe('helmUpgradeInstall', () => {
  it('builds helm upgrade --install with image set and kube context', async () => {
    const cfg = loadOpsConfig({
      OPS_KUBECONFIG: '/tmp/kube',
      OPS_KUBE_CONTEXT: 'prod',
    });
    const exec = recordingExec(async () => ({ code: 0, stdout: 'RELEASE: checkout\n', stderr: '' }));
    await helmUpgradeInstall(cfg, exec, {
      releaseName: 'checkout',
      chart: './charts/checkout',
      namespace: 'prod',
      createNamespace: true,
      imageRef: 'registry.example/ns/checkout:1.2.3',
      valuesFiles: ['./values-prod.yaml'],
      timeout: '5m',
      atomic: true,
    });
    const c = exec.calls[0];
    assert.equal(c.cmd, 'helm');
    assert.equal(c.args[0], 'upgrade');
    assert.equal(c.args[1], '--install');
    assert.ok(c.args.includes('checkout'));
    assert.ok(c.args.includes('./charts/checkout'));
    assert.ok(c.args.includes('-n'));
    assert.ok(c.args.includes('prod'));
    assert.ok(c.args.includes('--create-namespace'));
    assert.ok(c.args.includes('-f'));
    assert.ok(c.args.includes('./values-prod.yaml'));
    assert.ok(c.args.includes('--set'));
    assert.ok(c.args.some((a) => a.startsWith('image.repository=')));
    assert.ok(c.args.some((a) => a === 'image.tag=1.2.3' || a.startsWith('image.tag=')));
    assert.ok(c.args.includes('--wait'));
    assert.ok(c.args.includes('--atomic'));
    assert.ok(c.args.includes('--kube-context'));
    assert.ok(c.args.includes('prod'));
    assert.equal(c.env.KUBECONFIG, '/tmp/kube');
  });
});

describe('triggerRelease helm provider', () => {
  it('uses helm when OPS_RELEASE_PROVIDER=helm', async () => {
    const cfg = loadOpsConfig({
      OPS_RELEASE_PROVIDER: 'helm',
      OPS_HELM_CHART: './charts/app',
      OPS_HELM_RELEASE: 'app',
      OPS_HELM_NAMESPACE: 'default',
    });
    const exec = recordingExec(async () => ({ code: 0, stdout: 'ok\n', stderr: '' }));
    const result = await triggerRelease(cfg, exec, { imageRef: 'reg/app:9' });
    assert.equal(result.provider, 'helm');
    assert.equal(exec.calls[0].cmd, 'helm');
    assert.ok(exec.calls[0].args.includes('upgrade'));
  });
});

describe('helmRollback', () => {
  it('builds rollback argv', async () => {
    const cfg = loadOpsConfig({});
    const exec = recordingExec(async () => ({ code: 0, stdout: 'Rollback complete\n', stderr: '' }));
    await helmRollback(cfg, exec, { releaseName: 'app', namespace: 'prod', revision: 3 });
    assert.deepEqual(exec.calls[0].args.slice(0, 3), ['rollback', 'app', '3']);
  });
});
