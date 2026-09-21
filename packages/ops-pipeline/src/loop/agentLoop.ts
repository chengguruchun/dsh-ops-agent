/**
 * Autonomous AgentLoop: discover → diagnose → fix → review → release → verify
 *
 * Resilience (implemented, not docs-only):
 * - Retry + backoff around transient stage failures (k8s/logs/gitlab/release).
 * - Checkpoint JSON under `.ops-checkpoints/<runId>.json` for crash resume.
 * - Circuit breakers per dependency (gitlab, k8s, docker, logs, release).
 * - Degradation: Loki→kubectl logs; metrics soft-skip; release HTTP→script;
 *   review blockers hard-stop before release.
 *
 * Patch generation: DSH/LLM host must supply `patchFile` or `patchContent`.
 * This loop performs workspace git ops; it does not invent patches.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OpsConfig } from '../config.js';
import { loadOpsConfig } from '../config.js';
import type { ExecFn } from '../exec.js';
import { createProcessExec } from '../exec.js';
import { createGitlabClient } from '../stages/gitlab.js';
import { createCodingWorkspace } from '../stages/coding.js';
import { buildAndPushImage, dockerPull } from '../stages/image.js';
import { verifyRelease } from '../stages/verify.js';
import {
  CircuitBreaker,
  CircuitOpenError,
  createBreakerRegistry,
  restoreBreakers,
  snapshotBreakers,
  type BreakerRegistry,
} from './circuitBreaker.js';
import {
  CheckpointStore,
  emptyReport,
  type AgentLoopPhase,
  type AgentLoopReportSoFar,
  type CheckpointData,
} from './checkpoint.js';
import { discover, type DiscoveryReport } from './discover.js';
import { selfReview, type ReviewResult } from './review.js';
import { triggerReleaseWithFallback } from './degrade.js';
import { isTransientError, withRetry } from './retry.js';
import {
  assertRiskAllowed,
  evaluateRiskGate,
  RiskGateDeniedError,
  type RiskDecision,
  type MutatingAction,
} from '../runtime/riskGate.js';
import {
  createAgentState,
  type AgentState,
} from '../runtime/agentState.js';
import {
  createExecutionTrace,
  appendTraceEvent,
  appendRisk,
  appendGap,
  appendObservation,
  appendAction,
  appendVerification,
} from '../runtime/trace.js';
import {
  makeObservation,
  makeAction,
  makeVerification,
} from '../runtime/evidence.js';
import {
  computeGap,
  actualFromVerifyText,
  type ExpectedState,
  type ActualState,
  type GapResult,
} from '../runtime/gap.js';
import type { InMemoryEventBus } from '../runtime/eventBus.js';

export type FetchFn = typeof fetch;

export type AgentLoopOptions = {
  alert: unknown;
  config?: OpsConfig;
  exec?: ExecFn;
  fetchFn?: FetchFn;
  runId?: string;
  /** Resume from this runId's checkpoint (or set resumeFrom: true with runId). */
  resumeFrom?: string | boolean;
  checkpointDir?: string;
  /** Skip phases entirely. */
  skip?: Partial<Record<AgentLoopPhase, boolean>>;

  retry?: {
    retries?: number;
    minDelayMs?: number;
    maxDelayMs?: number;
    jitter?: boolean;
    sleep?: (ms: number) => Promise<void>;
  };
  circuit?: {
    failureThreshold?: number;
    cooldownMs?: number;
    now?: () => number;
  };

  coding?: {
    workspaceDir: string;
    repoUrl?: string;
    branch?: string;
    /** Path to unified diff file. */
    patchFile?: string;
    /** Inline unified diff (written to temp file then applied). */
    patchContent?: string;
    commitMessage?: string;
  };
  image?: {
    contextDir: string;
    dockerfile?: string;
    imageName: string;
    tag: string;
    fullRef?: string;
    login?: boolean;
    /** After push, also docker pull (e.g. verify registry reachability) */
    pullAfterPush?: boolean;
  };
  release?: {
    payload?: Record<string, unknown>;
    allowScriptFallback?: boolean;
    helm?: {
      chart?: string;
      releaseName?: string;
      namespace?: string;
      valuesFiles?: string[];
      set?: Record<string, string>;
      timeout?: string;
      atomic?: boolean;
      createNamespace?: boolean;
      imageRef?: string;
    };
  };
  verify?: { deployment: string; namespace?: string; timeout?: string };
  gitlabSearch?: string;
  issue?: { title?: string; description?: string; labels?: string[] };
  mergeRequest?: {
    sourceBranch: string;
    targetBranch?: string;
    title?: string;
    description?: string;
  };
  reviewCommand?: string;
  allowEmptyDiff?: boolean;

  /** V0.2 Risk gate: treat mutating release as approved (or set OPS_RISK_APPROVED). */
  riskApproved?: boolean;
  /** Skip risk gate entirely (tests only). */
  skipRiskGate?: boolean;
  /** Override mutating action for risk classification (tests / callers). */
  riskAction?: MutatingAction;
  /** Human-only break-glass (or OPS_RISK_HUMAN_UNLOCK). */
  riskHumanUnlock?: boolean;

  /** V0.3 goal stored in AgentState / checkpoint. */
  goal?: string;
  /** V0.4 expected state for post-verify gap. */
  expectedState?: ExpectedState;
  /** Inject actual state for gap tests (DI). */
  injectedActualState?: ActualState;
  /** V0.5 optional in-memory event bus. */
  eventBus?: InMemoryEventBus;
  /** V0.5 pause after this phase completes (experimental). */
  pauseAfterPhase?: AgentLoopPhase;

  /** Offline inject for discover tests. */
  injectedLogsText?: string;
  injectedPods?: Record<string, unknown>;
  injectedEvents?: Record<string, unknown>;
};

export type AgentLoopResult = {
  runId: string;
  ok: boolean;
  phase: AgentLoopPhase;
  report: AgentLoopReportSoFar;
  discovery?: DiscoveryReport;
  review?: ReviewResult;
  checkpointPath?: string;
  resumed: boolean;
  notes: string[];
  agentState?: AgentState;
  riskDecision?: RiskDecision;
  gap?: GapResult;
};

const PHASE_ORDER: AgentLoopPhase[] = [
  'discover',
  'diagnose',
  'fix',
  'review',
  'release',
  'verify',
  'done',
];

function phaseIndex(p: AgentLoopPhase): number {
  const i = PHASE_ORDER.indexOf(p);
  return i < 0 ? 0 : i;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const cfg = options.config ?? loadOpsConfig();
  const exec = options.exec ?? createProcessExec();
  const fetchFn = options.fetchFn ?? fetch;
  const skip = options.skip ?? {};
  const notes: string[] = [];

  const store = new CheckpointStore({ dir: options.checkpointDir });
  const runId =
    options.runId ??
    (typeof options.resumeFrom === 'string' ? options.resumeFrom : undefined) ??
    randomUUID();

  const resumeId =
    typeof options.resumeFrom === 'string'
      ? options.resumeFrom
      : options.resumeFrom === true
        ? runId
        : undefined;

  let checkpoint: CheckpointData | null = null;
  let resumed = false;
  if (resumeId) {
    checkpoint = await store.load(resumeId);
    if (checkpoint) {
      resumed = true;
      notes.push(`resumed from checkpoint phase=${checkpoint.phase}`);
    } else {
      notes.push(`no checkpoint for resume id=${resumeId}; starting fresh`);
    }
  }

  const retryOpts = {
    retries: options.retry?.retries ?? 2,
    minDelayMs: options.retry?.minDelayMs ?? 50,
    maxDelayMs: options.retry?.maxDelayMs ?? 2000,
    jitter: options.retry?.jitter ?? false,
    sleep: options.retry?.sleep,
    shouldRetry: (err: unknown) => !(err instanceof CircuitOpenError) && isTransientError(err),
  };

  const breakers = createBreakerRegistry(
    ['k8s', 'logs', 'gitlab', 'docker', 'release'],
    {
      failureThreshold: options.circuit?.failureThreshold ?? 3,
      cooldownMs: options.circuit?.cooldownMs ?? 30_000,
      now: options.circuit?.now,
    },
  );
  if (checkpoint?.breakerStates?.length) {
    restoreBreakers(breakers, checkpoint.breakerStates);
  }

  const report: AgentLoopReportSoFar = checkpoint?.report
    ? structuredClone(checkpoint.report)
    : emptyReport();
  let agentState: AgentState = checkpoint?.agentState
    ? structuredClone(checkpoint.agentState)
    : createAgentState({
        goal: options.goal,
        domain: 'ops',
        phase: 'init',
      });
  if (options.goal && !agentState.goal) agentState.goal = options.goal;
  const trace =
    agentState.trace ??
    createExecutionTrace(runId, checkpoint?.startedAt);
  agentState.trace = trace;
  const bus = options.eventBus;

  if (agentState.paused && resumeId) {
    agentState.paused = false;
    agentState.pauseReason = undefined;
    appendTraceEvent(trace, { type: 'resume', summary: 'resume from paused checkpoint' });
    notes.push('resumed from paused agentState');
    void bus?.emit('agent.resume', { runId });
  }

  const attemptCounts: Record<string, number> = {
    ...(checkpoint?.attemptCounts ?? {}),
  };
  const startedAt = checkpoint?.startedAt ?? new Date().toISOString();

  let phase: AgentLoopPhase = checkpoint?.phase && checkpoint.phase !== 'failed'
    ? checkpoint.phase === 'done'
      ? 'done'
      : nextPhaseAfter(checkpoint.phase)
    : 'discover';

  // If we crashed mid-phase, re-run that phase (checkpoint stores completed phase).
  // Convention: we save AFTER a phase completes, so resume starts at next phase.
  // If phase is 'init', start discover.
  if (!checkpoint) phase = 'discover';
  else if (checkpoint.phase === 'init') phase = 'discover';
  else if (checkpoint.phase === 'done') {
    return {
      runId,
      ok: report.ok,
      phase: 'done',
      report,
      discovery: report.discovery as DiscoveryReport | undefined,
      review: report.review as ReviewResult | undefined,
      resumed,
      notes: [...notes, 'already done'],
      agentState,
      riskDecision: agentState.lastRisk,
      gap: agentState.lastGap,
    };
  } else if (checkpoint.phase === 'failed') {
    phase = 'discover'; // allow full retry from start unless caller sets skip
    notes.push('previous run failed; restarting from discover');
  } else {
    phase = nextPhaseAfter(checkpoint.phase);
  }

  let discovery: DiscoveryReport | undefined = report.discovery as DiscoveryReport | undefined;
  let review: ReviewResult | undefined = report.review as ReviewResult | undefined;
  let imageRef: string | undefined = report.imageRef;
  let checkpointPath: string | undefined;

  const persist = async (p: AgentLoopPhase, extra?: Partial<CheckpointData>) => {
    phase = p;
    agentState.phase = p;
    const data: CheckpointData = {
      runId,
      phase: p,
      startedAt,
      updatedAt: new Date().toISOString(),
      report,
      attemptCounts,
      breakerStates: snapshotBreakers(breakers),
      context: {
        workspaceDir: options.coding?.workspaceDir,
        imageRef,
      },
      agentState,
      ...extra,
    };
    checkpointPath = await store.save(data);
    await bus?.emit('agent.checkpoint', { runId, phase: p });
  };

  const maybePause = async (completed: AgentLoopPhase): Promise<AgentLoopResult | null> => {
    if (options.pauseAfterPhase && options.pauseAfterPhase === completed) {
      agentState.paused = true;
      agentState.pauseReason = `pauseAfterPhase=${completed}`;
      appendTraceEvent(trace, {
        type: 'pause',
        summary: agentState.pauseReason,
      });
      await persist(completed);
      await bus?.emit('agent.pause', { runId, phase: completed });
      notes.push(`paused after phase=${completed}`);
      return {
        runId,
        ok: report.ok,
        phase: completed,
        report,
        discovery,
        review,
        checkpointPath,
        resumed,
        notes,
        agentState,
        riskDecision: agentState.lastRisk,
        gap: agentState.lastGap,
      };
    }
    return null;
  };


  await persist(checkpoint ? phase : 'init');

  try {
    // ── discover ──
    if (shouldRun(phase, 'discover', skip)) {
      phase = 'discover';
      attemptCounts.discover = (attemptCounts.discover ?? 0) + 1;
      discovery = await withRetry(
        () =>
          breakerExec(breakers, 'k8s', () =>
            breakerExec(breakers, 'logs', () =>
              discover({
                alert: options.alert,
                config: cfg,
                exec,
                fetchFn,
                gitlabSearch: options.gitlabSearch,
                injectedLogsText: options.injectedLogsText,
                injectedPods: options.injectedPods,
                injectedEvents: options.injectedEvents,
                skipK8s: skip.discover === true ? true : undefined,
              }),
            ),
          ),
        retryOpts,
      );
      report.discovery = discovery;
      pushPhase(report, {
        name: 'discover',
        ok: true,
        requestSummary: `discover service=${discovery.suspectService ?? '?'} hypotheses=${discovery.hypotheses.length}`,
        outputs: {
          suspectService: discovery.suspectService,
          errorSignatures: discovery.errorSignatures.slice(0, 10),
          hypotheses: discovery.hypotheses,
          notes: discovery.notes,
        },
        degraded: discovery.notes.filter((n) => /degrad|soft-skip|fallback/i.test(n)),
      });
      const obs = makeObservation({
        source: 'discover',
        summary: `suspect=${discovery.suspectService ?? '?'} hypotheses=${discovery.hypotheses.length}`,
        data: {
          suspectService: discovery.suspectService,
          hypotheses: discovery.hypotheses,
        },
      });
      agentState.observations.push(obs);
      appendObservation(trace, obs);
      await persist('discover');
      const pausedDiscover = await maybePause('discover');
      if (pausedDiscover) return pausedDiscover;
      phase = 'diagnose';
    }

    // ── diagnose (GitLab locate) ──
    if (shouldRun(phase, 'diagnose', skip)) {
      phase = 'diagnose';
      attemptCounts.diagnose = (attemptCounts.diagnose ?? 0) + 1;
      if (!cfg.gitlabUrl || !cfg.gitlabToken || !cfg.gitlabProject) {
        pushPhase(report, {
          name: 'diagnose',
          ok: true,
          skipped: true,
          requestSummary: 'skipped: GitLab env not set',
        });
      } else {
        try {
          const outputs = await withRetry(
            () =>
              breakers.get('gitlab')!.exec(async () => {
                const gl = createGitlabClient(cfg, fetchFn);
                const out: Record<string, unknown> = { project: await gl.getProject() };
                const q =
                  options.gitlabSearch ||
                  discovery?.errorSignatures[0] ||
                  discovery?.alert.name;
                if (q) out.search = await gl.searchCode(String(q).slice(0, 200));
                return out;
              }),
            retryOpts,
          );
          pushPhase(report, {
            name: 'diagnose',
            ok: true,
            requestSummary: `GitLab locate project=${cfg.gitlabProject}`,
            outputs,
          });
        } catch (err) {
          pushPhase(report, {
            name: 'diagnose',
            ok: false,
            error: errMsg(err),
          });
          // Non-fatal: continue to fix if patch provided
          notes.push(`diagnose failed (continuing): ${errMsg(err)}`);
        }
      }
      await persist('diagnose');
      const paused_diagnose = await maybePause('diagnose');
      if (paused_diagnose) return paused_diagnose;
      phase = 'fix';
    }

    // ── fix (coding workspace) ──
    if (shouldRun(phase, 'fix', skip)) {
      phase = 'fix';
      attemptCounts.fix = (attemptCounts.fix ?? 0) + 1;
      if (!options.coding?.workspaceDir) {
        pushPhase(report, {
          name: 'fix',
          ok: true,
          skipped: true,
          requestSummary: 'skipped: no coding.workspaceDir',
        });
        report.notes = [...(report.notes ?? []), 'fix skipped — DSH host should supply workspace + patch'];
      } else {
        const ws = createCodingWorkspace(exec, options.coding.workspaceDir);
        const outputs: Record<string, unknown> = {};
        let patchApplied = false;

        if (options.coding.repoUrl) {
          outputs.clone = await ws.cloneOrFetch(options.coding.repoUrl, {
            branch: options.coding.branch,
          });
        }
        if (options.coding.branch) {
          outputs.branch = await ws.createBranch(options.coding.branch);
        }

        let patchFile = options.coding.patchFile;
        if (!patchFile && options.coding.patchContent) {
          await mkdir(options.coding.workspaceDir, { recursive: true });
          patchFile = path.join(options.coding.workspaceDir, '.ops-agent-fix.patch');
          await writeFile(patchFile, options.coding.patchContent, 'utf8');
          outputs.patchContentFile = patchFile;
        }

        if (patchFile) {
          outputs.patch = await ws.applyPatchFile(patchFile);
          patchApplied = true;
        } else {
          outputs.note =
            'No patchFile/patchContent — LLM/DSH must supply patch via tool; workspace ready';
          notes.push('fix: waiting for DSH/LLM patch (workspace ops only)');
        }

        if (options.coding.commitMessage && patchApplied) {
          outputs.commit = await ws.commitAll(options.coding.commitMessage);
        }
        outputs.status = await ws.status();
        report.patchApplied = patchApplied;
        pushPhase(report, {
          name: 'fix',
          ok: true,
          requestSummary: `coding workspace ${options.coding.workspaceDir}`,
          outputs,
        });
      }
      await persist('fix');
      const paused_fix = await maybePause('fix');
      if (paused_fix) return paused_fix;
      phase = 'review';
    }

    // ── review (hard-stop before release) ──
    if (shouldRun(phase, 'review', skip)) {
      phase = 'review';
      attemptCounts.review = (attemptCounts.review ?? 0) + 1;
      if (!options.coding?.workspaceDir) {
        pushPhase(report, {
          name: 'review',
          ok: true,
          skipped: true,
          requestSummary: 'skipped: no workspace to review',
        });
        // Without workspace, treat as blocker for release safety
        review = {
          ok: false,
          findings: [
            {
              severity: 'blocker',
              code: 'no_workspace',
              message: 'No coding workspace — cannot review; hard-stop before release',
            },
          ],
          blockers: [
            {
              severity: 'blocker',
              code: 'no_workspace',
              message: 'No coding workspace — cannot review; hard-stop before release',
            },
          ],
          diffText: '',
          statusText: '',
          requestSummary: 'no workspace',
        };
        report.review = review;
      } else {
        review = await selfReview({
          workspaceDir: options.coding.workspaceDir,
          exec,
          reviewCommand: options.reviewCommand,
          allowEmptyDiff: options.allowEmptyDiff,
        });
        report.review = review;
        pushPhase(report, {
          name: 'review',
          ok: review.ok,
          requestSummary: review.requestSummary,
          outputs: { findings: review.findings, blockers: review.blockers },
          error: review.ok ? undefined : review.blockers.map((b) => b.message).join('; '),
        });
      }
      await persist('review');

      if (review && !review.ok) {
        report.ok = false;
        notes.push('review failed — hard-stop before release');
        await persist('failed', { lastError: 'review blockers' });
        return {
          runId,
          ok: false,
          phase: 'failed',
          report,
          discovery,
          review,
          checkpointPath,
          resumed,
          notes,
          agentState,
          riskDecision: agentState.lastRisk,
          gap: agentState.lastGap,
        };
      }
      const pausedReview = await maybePause('review');
      if (pausedReview) return pausedReview;
      phase = 'release';
    }

    // ── release (issue/MR + image + trigger) — gated by review + risk ──
    if (shouldRun(phase, 'release', skip)) {
      phase = 'release';
      attemptCounts.release = (attemptCounts.release ?? 0) + 1;

      // V0.2 Risk gate before mutating release path
      if (!options.skipRiskGate) {
        const mutatingKind =
          options.image
            ? 'docker_push'
            : cfg.releaseProvider === 'helm'
              ? 'helm_upgrade'
              : 'release_trigger';
        const mutatingAction: MutatingAction = options.riskAction ?? {
          kind: mutatingKind,
          summary: `release phase image=${Boolean(options.image)} provider=${cfg.releaseProvider}`,
          command:
            mutatingKind === 'docker_push'
              ? 'docker push'
              : mutatingKind === 'helm_upgrade'
                ? 'helm upgrade'
                : 'release trigger',
        };
        const riskDecision = evaluateRiskGate(mutatingAction, {
          approved: options.riskApproved,
          humanUnlock: options.riskHumanUnlock,
        });
        agentState.riskDecisions.push(riskDecision);
        agentState.lastRisk = riskDecision;
        appendRisk(trace, riskDecision);
        const riskActionRecord = makeAction({
          kind: String(mutatingAction.kind ?? mutatingKind),
          summary: riskDecision.reason,
          riskLevel: riskDecision.level,
          data: riskDecision,
        });
        agentState.actions.push(riskActionRecord);
        appendAction(trace, riskActionRecord);
        try {
          assertRiskAllowed(riskDecision, { reviewPassed: review?.ok !== false });
        } catch (err) {
          const denied =
            err instanceof RiskGateDeniedError ? err.decision : riskDecision;
          pushPhase(report, {
            name: 'release',
            ok: false,
            error: errMsg(err),
            outputs: { riskDecision: denied },
          });
          report.ok = false;
          notes.push(`risk gate hard-stop: ${errMsg(err)}`);
          await persist('failed', { lastError: errMsg(err) });
          await bus?.emit('agent.risk_denied', { runId, decision: denied });
          return {
            runId,
            ok: false,
            phase: 'failed',
            report,
            discovery,
            review,
            checkpointPath,
            resumed,
            notes,
            agentState,
            riskDecision: denied,
            gap: agentState.lastGap,
          };
        }
      }

      const outputs: Record<string, unknown> = {};
      const degraded: string[] = [];

      // GitLab issue / MR
      if (cfg.gitlabUrl && cfg.gitlabToken && cfg.gitlabProject) {
        try {
          await breakers.get('gitlab')!.exec(async () => {
            const gl = createGitlabClient(cfg, fetchFn);
            if (options.issue) {
              outputs.issue = await gl.createIssue({
                title:
                  options.issue.title ??
                  `[ops] ${discovery?.alert.name ?? 'incident'}`,
                description:
                  options.issue.description ??
                  formatIssueBody(discovery),
                labels: options.issue.labels ?? ['ops', 'incident'],
              });
            }
            if (options.mergeRequest) {
              outputs.mergeRequest = await gl.createMergeRequest({
                sourceBranch: options.mergeRequest.sourceBranch,
                targetBranch: options.mergeRequest.targetBranch ?? 'main',
                title:
                  options.mergeRequest.title ??
                  `[ops] fix ${discovery?.alert.name ?? 'incident'}`,
                description: options.mergeRequest.description,
              });
            }
          });
        } catch (err) {
          notes.push(`gitlab issue/MR failed: ${errMsg(err)}`);
          outputs.gitlabError = errMsg(err);
        }
      }

      // Image build/push
      if (options.image) {
        try {
          const img = await withRetry(
            () =>
              breakers.get('docker')!.exec(() => buildAndPushImage(cfg, exec, options.image!)),
            retryOpts,
          );
          imageRef = img.imageRef;
          report.imageRef = imageRef;
          outputs.image = { imageRef };
          if (options.image?.pullAfterPush) {
            const pulled = await withRetry(
              () =>
                breakers.get('docker')!.exec(() =>
                  dockerPull(cfg, exec, { imageRef: imageRef!, login: false }),
                ),
              retryOpts,
            );
            outputs.imagePull = {
              requestSummary: (pulled as { requestSummary: string }).requestSummary,
            };
          }
        } catch (err) {
          pushPhase(report, {
            name: 'release',
            ok: false,
            error: `image: ${errMsg(err)}`,
            outputs,
          });
          report.ok = false;
          await persist('failed', { lastError: errMsg(err) });
          return {
            runId,
            ok: false,
            phase: 'failed',
            report,
            discovery,
            review,
            checkpointPath,
            resumed,
      notes,
      agentState,
      riskDecision: agentState.lastRisk,
      gap: agentState.lastGap,
          };
        }
      }

      // Release trigger
      const canReleaseHttp = cfg.releaseProvider === 'http' && cfg.releaseWebhookUrl;
      const canReleaseScript = cfg.releaseProvider === 'script' && cfg.releaseScript;
      const canReleaseHelm =
        cfg.releaseProvider === 'helm' && Boolean(cfg.helmChart && cfg.helmReleaseName);
      const canFallbackScript = Boolean(cfg.releaseScript);
      if (!canReleaseHttp && !canReleaseScript && !canReleaseHelm && !canFallbackScript) {
        pushPhase(report, {
          name: 'release',
          ok: true,
          skipped: true,
          requestSummary: 'skipped: release provider config missing',
          outputs,
        });
      } else {
        try {
          const payload = {
            alert: discovery?.alert
              ? {
                  name: discovery.alert.name,
                  fingerprint: discovery.alert.fingerprint,
                  severity: discovery.alert.severity,
                }
              : undefined,
            imageRef,
            ...(options.release?.payload ?? {}),
          };
          const rel = await withRetry(
            () =>
              breakers.get('release')!.exec(() =>
                triggerReleaseWithFallback(cfg, exec, payload, fetchFn, {
                  allowScriptFallback: options.release?.allowScriptFallback !== false,
                  helm: {
                    ...(options.release?.helm ?? {}),
                    imageRef:
                      options.release?.helm?.imageRef ??
                      (typeof imageRef === 'string' ? imageRef : undefined),
                  },
                }),
              ),
            retryOpts,
          );
          if (rel.fallbackUsed) {
            degraded.push(`release fallback=${rel.fallbackUsed}`);
            notes.push(`release degraded to ${rel.fallbackUsed}`);
          }
          outputs.release = {
            provider: rel.provider,
            requestSummary: rel.requestSummary,
            responseText: rel.responseText.slice(0, 2000),
            fallbackUsed: rel.fallbackUsed,
          };
          pushPhase(report, {
            name: 'release',
            ok: true,
            requestSummary: rel.requestSummary,
            outputs,
            degraded,
          });
        } catch (err) {
          pushPhase(report, {
            name: 'release',
            ok: false,
            error: errMsg(err),
            outputs,
          });
          report.ok = false;
          await persist('failed', { lastError: errMsg(err) });
          return {
            runId,
            ok: false,
            phase: 'failed',
            report,
            discovery,
            review,
            checkpointPath,
            resumed,
      notes,
      agentState,
      riskDecision: agentState.lastRisk,
      gap: agentState.lastGap,
          };
        }
      }
      await persist('release');
      const pausedRelease = await maybePause('release');
      if (pausedRelease) return pausedRelease;
      phase = 'verify';
    }

    // ── verify ──
    if (shouldRun(phase, 'verify', skip)) {
      phase = 'verify';
      attemptCounts.verify = (attemptCounts.verify ?? 0) + 1;
      if (!options.verify?.deployment) {
        pushPhase(report, {
          name: 'verify',
          ok: true,
          skipped: true,
          requestSummary: 'skipped: no verify.deployment',
        });
      } else {
        try {
          const result = await withRetry(
            () =>
              breakers.get('k8s')!.exec(() =>
                verifyRelease(cfg, exec, {
                  deployment: options.verify!.deployment,
                  namespace: options.verify!.namespace ?? discovery?.namespace,
                  timeout: options.verify!.timeout,
                  logQuery: discovery?.suspectService
                    ? {
                        service: discovery.suspectService,
                        namespace: discovery.namespace,
                        since: '15m',
                      }
                    : undefined,
                }),
              ),
            retryOpts,
          );
          const expected: ExpectedState = {
            deployment: options.verify!.deployment,
            namespace: options.verify!.namespace ?? discovery?.namespace,
            imageRef: imageRef,
            rolloutComplete: true,
            ...(options.expectedState ?? {}),
          };
          const actual: ActualState =
            options.injectedActualState ??
            actualFromVerifyText(result.rollout.text, {
              deployment: options.verify!.deployment,
              namespace: options.verify!.namespace ?? discovery?.namespace,
              imageRef,
            });
          const gap = await computeGap(expected, { actual });
          agentState.lastGap = gap;
          appendGap(trace, gap);
          const ver = makeVerification({
            resultIds: [],
            ok: gap.ok,
            summary: gap.summary,
            gapId: gap.id,
            data: { nextActionHint: gap.nextActionHint },
          });
          agentState.verifications.push(ver);
          appendVerification(trace, ver);
          const verifyOk = gap.ok;
          pushPhase(report, {
            name: 'verify',
            ok: verifyOk,
            requestSummary: result.rollout.requestSummary,
            outputs: {
              rollout: result.rollout.text.slice(0, 1000),
              logs: result.logs
                ? { provider: result.logs.provider, textLength: result.logs.text.length }
                : undefined,
              gap,
            },
            error: verifyOk ? undefined : gap.summary,
          });
          if (!verifyOk) {
            report.ok = false;
            notes.push(`gap after verify: ${gap.summary}`);
            if (gap.nextActionHint) notes.push(`nextActionHint: ${gap.nextActionHint}`);
            await persist('failed', { lastError: gap.summary });
            await bus?.emit('agent.gap', { runId, gap });
            return {
              runId,
              ok: false,
              phase: 'failed',
              report,
              discovery,
              review,
              checkpointPath,
              resumed,
              notes,
              agentState,
              riskDecision: agentState.lastRisk,
              gap,
            };
          }
        } catch (err) {
          pushPhase(report, {
            name: 'verify',
            ok: false,
            error: errMsg(err),
          });
          report.ok = false;
          await persist('failed', { lastError: errMsg(err) });
          return {
            runId,
            ok: false,
            phase: 'failed',
            report,
            discovery,
            review,
            checkpointPath,
            resumed,
            notes,
            agentState,
            riskDecision: agentState.lastRisk,
            gap: agentState.lastGap,
          };
        }
      }
      await persist('verify');
      const pausedVerify = await maybePause('verify');
      if (pausedVerify) return pausedVerify;
    }

    report.ok = report.phases.every((p) => p.ok || p.skipped);
    await persist('done');
    return {
      runId,
      ok: report.ok,
      phase: 'done',
      report,
      discovery,
      review,
      checkpointPath,
      resumed,
      notes,
      agentState,
      riskDecision: agentState.lastRisk,
      gap: agentState.lastGap,
    };
  } catch (err) {
    report.ok = false;
    notes.push(errMsg(err));
    await persist('failed', { lastError: errMsg(err) });
    return {
      runId,
      ok: false,
      phase: 'failed',
      report,
      discovery,
      review,
      checkpointPath,
      resumed,
      notes,
      agentState,
      riskDecision: agentState.lastRisk,
      gap: agentState.lastGap,
    };
  }
}

function shouldRun(
  current: AgentLoopPhase,
  target: AgentLoopPhase,
  skip: Partial<Record<AgentLoopPhase, boolean>>,
): boolean {
  if (skip[target]) return false;
  return phaseIndex(current) <= phaseIndex(target);
}

function nextPhaseAfter(completed: AgentLoopPhase): AgentLoopPhase {
  const i = phaseIndex(completed);
  if (completed === 'done' || completed === 'failed' || completed === 'init') return 'discover';
  return PHASE_ORDER[Math.min(i + 1, PHASE_ORDER.length - 1)]!;
}

function pushPhase(
  report: AgentLoopReportSoFar,
  step: AgentLoopReportSoFar['phases'][number],
): void {
  const idx = report.phases.findIndex((p) => p.name === step.name);
  if (idx >= 0) report.phases[idx] = step;
  else report.phases.push(step);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatIssueBody(discovery?: DiscoveryReport): string {
  if (!discovery) return 'Auto-filed from ops-pipeline AgentLoop.';
  const hyps = discovery.hypotheses.map((h) => `- (${h.confidence}) ${h.summary}`).join('\n');
  const sigs = discovery.errorSignatures.slice(0, 15).map((s) => `- ${s}`).join('\n');
  return [
    'Auto-filed from ops-pipeline AgentLoop.',
    '',
    `## Alert`,
    `- name: ${discovery.alert.name}`,
    `- severity: ${discovery.alert.severity}`,
    `- service: ${discovery.suspectService ?? 'n/a'}`,
    `- summary: ${discovery.alert.summary}`,
    '',
    '## Hypotheses',
    hyps || '- (none)',
    '',
    '## Error signatures',
    sigs || '- (none)',
  ].join('\n');
}

async function breakerExec<T>(
  reg: BreakerRegistry,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const b = reg.get(name);
  if (!b) return fn();
  return b.exec(fn);
}

/** Convenience: load checkpoint without running. */
export async function loadAgentLoopCheckpoint(
  runId: string,
  checkpointDir?: string,
): Promise<CheckpointData | null> {
  const store = new CheckpointStore({ dir: checkpointDir });
  return store.load(runId);
}
