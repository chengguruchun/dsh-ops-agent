import type { OpsConfig } from '../config.js';
import type { ExecFn } from '../exec.js';
import { assertOk } from '../exec.js';

export type ImageBuildPushOpts = {
  contextDir: string;
  dockerfile?: string;
  imageName: string;
  tag: string;
  fullRef?: string;
  buildArgs?: Record<string, string>;
  login?: boolean;
};

export type ImageResult = {
  imageRef: string;
  steps: Array<{ requestSummary: string; stdout: string; stderr: string }>;
};

function resolveRef(cfg: OpsConfig, opts: ImageBuildPushOpts): string {
  if (opts.fullRef) return opts.fullRef;
  const parts: string[] = [];
  if (cfg.dockerRegistry) parts.push(cfg.dockerRegistry.replace(/\/$/, ''));
  if (cfg.dockerNamespace) parts.push(cfg.dockerNamespace);
  parts.push(opts.imageName);
  return `${parts.join('/')}:${opts.tag}`;
}

export async function dockerLogin(
  cfg: OpsConfig,
  exec: ExecFn,
): Promise<{ requestSummary: string }> {
  if (!cfg.dockerRegistry || !cfg.dockerUsername || !cfg.dockerPassword) {
    throw new Error(
      'docker login needs OPS_DOCKER_REGISTRY, OPS_DOCKER_USERNAME, OPS_DOCKER_PASSWORD',
    );
  }
  const result = await exec({
    cmd: 'docker',
    args: ['login', cfg.dockerRegistry, '-u', cfg.dockerUsername, '--password-stdin'],
    stdin: cfg.dockerPassword,
  });
  assertOk(result, 'docker login');
  return {
    requestSummary: `docker login ${cfg.dockerRegistry} -u ${cfg.dockerUsername} --password-stdin`,
  };
}

/** Pull an image from the registry (real `docker pull`). */
export async function dockerPull(
  cfg: OpsConfig,
  exec: ExecFn,
  opts: { imageRef: string; login?: boolean },
): Promise<{ imageRef: string; requestSummary: string; stdout: string; stderr: string }> {
  if (opts.login) {
    await dockerLogin(cfg, exec);
  }
  const args = ['pull', opts.imageRef];
  const result = await exec({ cmd: 'docker', args });
  assertOk(result, 'docker pull');
  return {
    imageRef: opts.imageRef,
    requestSummary: `docker pull ${opts.imageRef}`,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function buildAndPushImage(
  cfg: OpsConfig,
  exec: ExecFn,
  opts: ImageBuildPushOpts,
): Promise<ImageResult> {
  const ref = resolveRef(cfg, opts);
  const steps: ImageResult['steps'] = [];

  if (opts.login) {
    const login = await dockerLogin(cfg, exec);
    steps.push({ requestSummary: login.requestSummary, stdout: '', stderr: '' });
  }

  const buildArgs = ['build', '-t', ref];
  if (opts.dockerfile) buildArgs.push('-f', opts.dockerfile);
  if (opts.buildArgs) {
    for (const [k, v] of Object.entries(opts.buildArgs)) {
      buildArgs.push('--build-arg', `${k}=${v}`);
    }
  }
  buildArgs.push(opts.contextDir);

  const build = await exec({ cmd: 'docker', args: buildArgs });
  assertOk(build, 'docker build');
  steps.push({
    requestSummary: `docker ${buildArgs.join(' ')}`,
    stdout: build.stdout,
    stderr: build.stderr,
  });

  const push = await exec({ cmd: 'docker', args: ['push', ref] });
  assertOk(push, 'docker push');
  steps.push({
    requestSummary: `docker push ${ref}`,
    stdout: push.stdout,
    stderr: push.stderr,
  });

  return { imageRef: ref, steps };
}
