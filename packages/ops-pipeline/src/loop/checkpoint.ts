/**
 * Persist AgentLoop state to JSON so a run can resume after crash/restart.
 * Default dir: `.ops-checkpoints/<runId>.json` (cwd-relative or absolute).
 */

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import type { CircuitBreakerSnapshot } from './circuitBreaker.js';
import type { AgentState } from '../runtime/agentState.js';

export type AgentLoopPhase =
  | 'init'
  | 'discover'
  | 'diagnose'
  | 'fix'
  | 'review'
  | 'release'
  | 'verify'
  | 'done'
  | 'failed';

export type CheckpointData = {
  runId: string;
  phase: AgentLoopPhase;
  updatedAt: string;
  startedAt: string;
  /** Phase results accumulated so far (serializable). */
  report: AgentLoopReportSoFar;
  attemptCounts: Record<string, number>;
  breakerStates: CircuitBreakerSnapshot[];
  /** Optional opaque bag for resume (workspace paths, imageRef, etc.). */
  context?: Record<string, unknown>;
  lastError?: string;
  /** V0.3+ rich agent state (goal, observations, risk, pause…). */
  agentState?: AgentState;
};

export type AgentLoopReportSoFar = {
  ok: boolean;
  phases: Array<{
    name: AgentLoopPhase;
    ok: boolean;
    skipped?: boolean;
    requestSummary?: string;
    outputs?: unknown;
    error?: string;
    degraded?: string[];
  }>;
  discovery?: unknown;
  review?: unknown;
  imageRef?: string;
  patchApplied?: boolean;
  notes?: string[];
};

export type CheckpointStoreOptions = {
  dir?: string;
};

export class CheckpointStore {
  readonly dir: string;

  constructor(opts: CheckpointStoreOptions = {}) {
    this.dir = path.resolve(opts.dir ?? '.ops-checkpoints');
  }

  pathFor(runId: string): string {
    const safe = runId.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async save(data: CheckpointData): Promise<string> {
    await this.ensureDir();
    const file = this.pathFor(data.runId);
    const payload: CheckpointData = {
      ...data,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
    return file;
  }

  async load(runId: string): Promise<CheckpointData | null> {
    const file = this.pathFor(runId);
    try {
      await access(file);
    } catch {
      return null;
    }
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as CheckpointData;
  }

  async exists(runId: string): Promise<boolean> {
    try {
      await access(this.pathFor(runId));
      return true;
    } catch {
      return false;
    }
  }
}

export function emptyReport(): AgentLoopReportSoFar {
  return { ok: true, phases: [], notes: [] };
}
