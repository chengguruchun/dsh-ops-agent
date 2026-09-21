/**
 * CodeReviewLoop (sibling of ops AgentLoop — NOT nested inside it).
 *
 * Phases: fetch → analyze → optional static → summarize → optional publish
 *
 * Deep LLM review is the DSH host's job. This loop accepts injected
 * `llmSummary` / `reviewNotes` and merges them into the published comment.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CodeReviewConfig } from '../config.js';
import { loadCodeReviewConfig } from '../config.js';
import type { ExecFn } from '../exec.js';
import { createProcessExec } from '../exec.js';
import { fetchPr, type PullRequestRef } from '../stages/fetchPr.js';
import { listChangedFiles, type ChangedFile } from '../stages/listChangedFiles.js';
import { heuristicReview, type HeuristicReviewResult } from '../stages/heuristicReview.js';
import { runStaticChecks, type StaticCheckResult } from '../stages/runStaticChecks.js';
import { postReviewComment } from '../stages/postReviewComment.js';

export type CodeReviewPhase =
  | 'init'
  | 'fetch'
  | 'analyze'
  | 'static'
  | 'summarize'
  | 'publish'
  | 'done'
  | 'failed';

export type CodeReviewLoopOptions = {
  number: number;
  repo?: string;
  cwd?: string;
  config?: CodeReviewConfig;
  exec?: ExecFn;
  runId?: string;
  /** Resume from checkpoint for this runId (or pass resumeFrom: true with runId). */
  resumeFrom?: string | boolean;
  checkpointDir?: string;
  skip?: Partial<Record<Exclude<CodeReviewPhase, 'init' | 'done' | 'failed'>, boolean>>;
  /** Force static checks on/off (overrides config.enableStaticChecks). */
  runStatic?: boolean;
  /** Force publish on/off (overrides config.enablePublish). */
  publish?: boolean;
  /** Host-provided LLM narrative (DSH). */
  llmSummary?: string;
  /** Extra bullet notes from host / prior tools. */
  reviewNotes?: string[];
  reviewCommand?: string;
  /** Offline inject (skip live fetch). */
  injectedPr?: PullRequestRef;
  injectedFiles?: ChangedFile[];
  injectedDiffText?: string;
};

export type CodeReviewSummary = {
  title: string;
  body: string;
  findingsCount: number;
  blockerCount: number;
  warningCount: number;
};

export type CodeReviewLoopResult = {
  runId: string;
  ok: boolean;
  phase: CodeReviewPhase;
  pr?: PullRequestRef;
  files?: ChangedFile[];
  heuristic?: HeuristicReviewResult;
  staticChecks?: StaticCheckResult;
  summary?: CodeReviewSummary;
  published?: { requestSummary: string; stdout: string };
  checkpointPath?: string;
  resumed: boolean;
  notes: string[];
};

const PHASE_ORDER: CodeReviewPhase[] = [
  'init',
  'fetch',
  'analyze',
  'static',
  'summarize',
  'publish',
  'done',
];

function nextPhaseAfter(p: CodeReviewPhase): CodeReviewPhase {
  const i = PHASE_ORDER.indexOf(p);
  if (i < 0 || i >= PHASE_ORDER.length - 1) return 'done';
  return PHASE_ORDER[i + 1]!;
}

function shouldRun(
  current: CodeReviewPhase,
  target: CodeReviewPhase,
  skip: CodeReviewLoopOptions['skip'],
): boolean {
  if (skip && (skip as Record<string, boolean>)[target]) return false;
  const ci = PHASE_ORDER.indexOf(current);
  const ti = PHASE_ORDER.indexOf(target);
  return ci <= ti;
}

type CheckpointBlob = {
  runId: string;
  phase: CodeReviewPhase;
  number: number;
  pr?: PullRequestRef;
  files?: ChangedFile[];
  diffText?: string;
  heuristic?: HeuristicReviewResult;
  staticChecks?: StaticCheckResult;
  summary?: CodeReviewSummary;
  notes: string[];
  updatedAt: string;
};

function buildSummaryBody(opts: {
  pr?: PullRequestRef;
  heuristic?: HeuristicReviewResult;
  staticChecks?: StaticCheckResult;
  llmSummary?: string;
  reviewNotes?: string[];
}): CodeReviewSummary {
  const findings = opts.heuristic?.findings ?? [];
  const blockers = findings.filter((f) => f.severity === 'blocker');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const lines: string[] = [];
  lines.push(`## Code review (dsh-ops-agent/code-review)`);
  if (opts.pr) {
    lines.push(`**PR/MR #${opts.pr.number}** — ${opts.pr.title}`);
    if (opts.pr.author) lines.push(`Author: @${opts.pr.author}`);
  }
  lines.push('');
  if (opts.llmSummary?.trim()) {
    lines.push('### LLM summary (host)');
    lines.push(opts.llmSummary.trim());
    lines.push('');
  }
  if (opts.reviewNotes?.length) {
    lines.push('### Notes');
    for (const n of opts.reviewNotes) lines.push(`- ${n}`);
    lines.push('');
  }
  if (opts.heuristic) {
    lines.push('### Heuristics');
    lines.push(
      `- files=${opts.heuristic.stats.fileCount}, diffLines=${opts.heuristic.stats.diffLines}, todos=${opts.heuristic.stats.todoCount}, tests=${opts.heuristic.stats.testFileCount}`,
    );
    for (const f of findings) {
      lines.push(`- **${f.severity}** \`${f.code}\`: ${f.message}`);
    }
    lines.push('');
  }
  if (opts.staticChecks && !opts.staticChecks.skipped) {
    lines.push('### Static checks');
    lines.push(
      `- \`${opts.staticChecks.command}\` → exit ${opts.staticChecks.exitCode} (${opts.staticChecks.ok ? 'ok' : 'failed'})`,
    );
    lines.push('');
  }
  lines.push(
    '_Deep semantic review is performed by the DSH host; this package covers fetch / heuristics / publish._',
  );
  const title = opts.pr
    ? `Code review: #${opts.pr.number} ${opts.pr.title}`.slice(0, 120)
    : 'Code review summary';
  return {
    title,
    body: lines.join('\n'),
    findingsCount: findings.length,
    blockerCount: blockers.length,
    warningCount: warnings.length,
  };
}

export async function runCodeReviewLoop(
  options: CodeReviewLoopOptions,
): Promise<CodeReviewLoopResult> {
  const cfg = options.config ?? loadCodeReviewConfig();
  const exec = options.exec ?? createProcessExec();
  const skip = options.skip ?? {};
  const notes: string[] = [];
  const runId =
    options.runId ??
    (typeof options.resumeFrom === 'string' ? options.resumeFrom : undefined) ??
    randomUUID();

  const checkpointDir =
    options.checkpointDir ?? cfg.checkpointDir ?? path.join(process.cwd(), '.cr-checkpoints');
  const checkpointPath = path.join(checkpointDir, `${runId}.json`);

  const resumeId =
    typeof options.resumeFrom === 'string'
      ? options.resumeFrom
      : options.resumeFrom === true
        ? runId
        : undefined;

  let checkpoint: CheckpointBlob | null = null;
  let resumed = false;
  if (resumeId) {
    try {
      const raw = await readFile(path.join(checkpointDir, `${resumeId}.json`), 'utf8');
      checkpoint = JSON.parse(raw) as CheckpointBlob;
      resumed = true;
      notes.push(`resumed from checkpoint phase=${checkpoint.phase}`);
    } catch {
      notes.push(`no checkpoint for resume id=${resumeId}; starting fresh`);
    }
  }

  let phase: CodeReviewPhase = 'fetch';
  let pr: PullRequestRef | undefined = checkpoint?.pr;
  let files: ChangedFile[] | undefined = checkpoint?.files;
  let diffText: string | undefined = checkpoint?.diffText;
  let heuristic: HeuristicReviewResult | undefined = checkpoint?.heuristic;
  let staticChecks: StaticCheckResult | undefined = checkpoint?.staticChecks;
  let summary: CodeReviewSummary | undefined = checkpoint?.summary;
  let published: { requestSummary: string; stdout: string } | undefined;

  if (!checkpoint) {
    phase = 'fetch';
  } else if (checkpoint.phase === 'done') {
    return {
      runId,
      ok: (checkpoint.heuristic?.ok ?? true) && (checkpoint.staticChecks?.ok ?? true),
      phase: 'done',
      pr: checkpoint.pr,
      files: checkpoint.files,
      heuristic: checkpoint.heuristic,
      staticChecks: checkpoint.staticChecks,
      summary: checkpoint.summary,
      checkpointPath,
      resumed,
      notes: [...notes, ...(checkpoint.notes ?? []), 'already done'],
    };
  } else if (checkpoint.phase === 'failed') {
    phase = 'fetch';
    notes.push('previous run failed; restarting from fetch');
  } else {
    phase = nextPhaseAfter(checkpoint.phase);
  }

  const persist = async (p: CodeReviewPhase) => {
    phase = p;
    await mkdir(checkpointDir, { recursive: true });
    const blob: CheckpointBlob = {
      runId,
      phase: p,
      number: options.number,
      pr,
      files,
      diffText,
      heuristic,
      staticChecks,
      summary,
      notes,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(checkpointPath, JSON.stringify(blob, null, 2), 'utf8');
  };

  try {
    // ── fetch ──
    if (shouldRun(phase, 'fetch', skip)) {
      phase = 'fetch';
      if (options.injectedPr) {
        pr = options.injectedPr;
        notes.push('fetch: used injectedPr');
      } else {
        const fetched = await fetchPr(cfg, exec, {
          number: options.number,
          repo: options.repo,
          cwd: options.cwd,
        });
        pr = fetched.pr;
        notes.push(fetched.requestSummary);
      }
      if (options.injectedFiles || options.injectedDiffText !== undefined) {
        files = options.injectedFiles ?? files ?? [];
        diffText = options.injectedDiffText;
        notes.push('fetch: used injectedFiles/diff');
      } else {
        const listed = await listChangedFiles(cfg, exec, {
          number: options.number,
          repo: options.repo,
          cwd: options.cwd,
        });
        files = listed.files;
        diffText = listed.diffText;
        notes.push(listed.requestSummary);
      }
      await persist('fetch');
      phase = 'analyze';
    } else if (skip.fetch) {
      if (options.injectedPr) pr = options.injectedPr;
      if (options.injectedFiles) files = options.injectedFiles;
      if (options.injectedDiffText) diffText = options.injectedDiffText;
      notes.push('fetch skipped');
      await persist('fetch');
      phase = 'analyze';
    }

    // ── analyze ──
    if (shouldRun(phase, 'analyze', skip)) {
      phase = 'analyze';
      heuristic = heuristicReview(cfg, {
        pr,
        files: files ?? [],
        diffText,
      });
      notes.push(heuristic.requestSummary);
      await persist('analyze');
      phase = 'static';
    } else if (skip.analyze) {
      notes.push('analyze skipped');
      await persist('analyze');
      phase = 'static';
    }

    // ── static (optional) ──
    const runStatic =
      options.runStatic ??
      (cfg.enableStaticChecks && Boolean(options.reviewCommand ?? cfg.reviewCommand));
    if (shouldRun(phase, 'static', skip)) {
      phase = 'static';
      if (!runStatic) {
        staticChecks = {
          ok: true,
          skipped: true,
          exitCode: 0,
          stdout: '',
          stderr: '',
          requestSummary: 'skipped: static checks disabled / no CR_REVIEW_COMMAND',
        };
      } else {
        staticChecks = await runStaticChecks(cfg, exec, {
          cwd: options.cwd,
          reviewCommand: options.reviewCommand,
        });
      }
      notes.push(staticChecks.requestSummary);
      await persist('static');
      phase = 'summarize';
    } else if (skip.static) {
      staticChecks = {
        ok: true,
        skipped: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        requestSummary: 'skipped: skip.static',
      };
      notes.push(staticChecks.requestSummary);
      await persist('static');
      phase = 'summarize';
    }

    // ── summarize ──
    if (shouldRun(phase, 'summarize', skip)) {
      phase = 'summarize';
      summary = buildSummaryBody({
        pr,
        heuristic,
        staticChecks,
        llmSummary: options.llmSummary,
        reviewNotes: options.reviewNotes,
      });
      notes.push(
        `summarize findings=${summary.findingsCount} blockers=${summary.blockerCount}`,
      );
      await persist('summarize');
      phase = 'publish';
    } else if (skip.summarize) {
      notes.push('summarize skipped');
      await persist('summarize');
      phase = 'publish';
    }

    // ── publish (optional) ──
    const doPublish = options.publish ?? cfg.enablePublish;
    if (shouldRun(phase, 'publish', skip)) {
      phase = 'publish';
      if (!doPublish) {
        notes.push('publish skipped (CR_PUBLISH/off)');
        await persist('publish');
      } else {
        if (!summary?.body) {
          summary = buildSummaryBody({
            pr,
            heuristic,
            staticChecks,
            llmSummary: options.llmSummary,
            reviewNotes: options.reviewNotes,
          });
        }
        const posted = await postReviewComment(cfg, exec, {
          number: options.number,
          body: summary.body,
          repo: options.repo,
          cwd: options.cwd,
        });
        published = { requestSummary: posted.requestSummary, stdout: posted.stdout };
        notes.push(posted.requestSummary);
        await persist('publish');
      }
      phase = 'done';
    } else if (skip.publish) {
      notes.push('publish skipped (skip.publish)');
      await persist('publish');
      phase = 'done';
    }

    await persist('done');

    const ok =
      (heuristic?.ok ?? true) && (staticChecks == null || staticChecks.skipped || staticChecks.ok);

    return {
      runId,
      ok,
      phase: 'done',
      pr,
      files,
      heuristic,
      staticChecks,
      summary,
      published,
      checkpointPath,
      resumed,
      notes,
    };
  } catch (err) {
    notes.push(`failed: ${err instanceof Error ? err.message : String(err)}`);
    await persist('failed').catch(() => undefined);
    return {
      runId,
      ok: false,
      phase: 'failed',
      pr,
      files,
      heuristic,
      staticChecks,
      summary,
      published,
      checkpointPath,
      resumed,
      notes,
    };
  }
}

export async function loadCodeReviewCheckpoint(
  runId: string,
  checkpointDir?: string,
): Promise<CheckpointBlob | null> {
  const dir = checkpointDir ?? path.join(process.cwd(), '.cr-checkpoints');
  try {
    const raw = await readFile(path.join(dir, `${runId}.json`), 'utf8');
    return JSON.parse(raw) as CheckpointBlob;
  } catch {
    return null;
  }
}
