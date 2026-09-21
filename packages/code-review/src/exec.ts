import { spawn } from 'node:child_process';

export type ExecResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export type ExecRequest = {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Written to child stdin. Never logged by createProcessExec. */
  stdin?: string;
};

export type ExecFn = (req: ExecRequest) => Promise<ExecResult>;

export type ProcessExecOptions = {
  defaultCwd?: string;
  defaultEnv?: NodeJS.ProcessEnv;
  defaultTimeoutMs?: number;
};

/** Real process runner via child_process.spawn (no shell). Injectable in tests. */
export function createProcessExec(options: ProcessExecOptions = {}): ExecFn {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
  return (req) =>
    new Promise<ExecResult>((resolve, reject) => {
      const args = req.args ?? [];
      const env = { ...process.env, ...options.defaultEnv, ...req.env };
      const child = spawn(req.cmd, args, {
        cwd: req.cwd ?? options.defaultCwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const timeoutMs = req.timeoutMs ?? defaultTimeoutMs;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (settled) return;
              settled = true;
              child.kill('SIGKILL');
              reject(
                new Error(`exec timeout after ${timeoutMs}ms: ${req.cmd} ${args.join(' ')}`),
              );
            }, timeoutMs)
          : undefined;

      child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
      child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

      if (req.stdin != null) {
        child.stdin.write(req.stdin);
      }
      child.stdin.end();

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({
          code,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
        });
      });
    });
}

export function assertOk(result: ExecResult, label: string): void {
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${label} failed (exit ${result.code}): ${detail}`);
  }
}
