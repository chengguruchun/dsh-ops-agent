import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCodeReviewConfig } from '../dist/config.js';
import { runCodeReviewLoop } from '../dist/loop/codeReviewLoop.js';
import { listCrToolNames, CR_TOOL_CATALOG } from '../dist/tools/catalog.js';

describe('CR_TOOL_CATALOG', () => {
  it('exposes expected tool names', () => {
    assert.deepEqual(listCrToolNames().sort(), [
      'cr_fetch_pr',
      'cr_heuristic_review',
      'cr_list_files',
      'cr_post_comment',
      'cr_review_loop_start',
      'cr_run_checks',
    ]);
    assert.equal(CR_TOOL_CATALOG.length, 6);
  });
});

describe('runCodeReviewLoop (offline inject)', () => {
  it('fetch→analyze→summarize with injected PR and llmSummary', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cr-loop-'));
    try {
      const cfg = loadCodeReviewConfig({ CR_PUBLISH: 'false', CR_STATIC_CHECKS: 'false' });
      const result = await runCodeReviewLoop({
        number: 9,
        config: cfg,
        checkpointDir: dir,
        runId: 'run-1',
        llmSummary: 'Looks mostly fine; watch error handling.',
        reviewNotes: ['host note A'],
        injectedPr: {
          provider: 'github',
          number: 9,
          title: 'Add feature',
          body: 'implements X',
          author: 'ryan',
        },
        injectedFiles: [
          { path: 'src/feature.ts' },
          { path: 'src/feature.test.ts' },
        ],
        injectedDiffText: '+export function feature() {}\n',
        exec: async () => {
          throw new Error('exec should not run with full inject');
        },
        publish: false,
        runStatic: false,
      });
      assert.equal(result.ok, true);
      assert.equal(result.phase, 'done');
      assert.equal(result.pr.title, 'Add feature');
      assert.ok(result.summary.body.includes('LLM summary'));
      assert.ok(result.summary.body.includes('Looks mostly fine'));
      assert.ok(result.summary.body.includes('host note A'));
      assert.equal(result.published, undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('can resume after analyze via checkpoint', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cr-resume-'));
    try {
      const cfg = loadCodeReviewConfig({});
      const first = await runCodeReviewLoop({
        number: 3,
        config: cfg,
        checkpointDir: dir,
        runId: 'seed',
        skip: { static: true, summarize: true, publish: true },
        injectedPr: {
          provider: 'github',
          number: 3,
          title: 'T',
          body: '',
        },
        injectedFiles: [{ path: 'a.ts' }],
        injectedDiffText: '+x\n',
        exec: async () => ({ code: 0, stdout: '', stderr: '' }),
      });
      assert.ok(first.heuristic);

      // Simulate partial checkpoint after analyze (ops-style), then resume.
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'resume-me.json'),
        JSON.stringify(
          {
            runId: 'resume-me',
            phase: 'analyze',
            number: 3,
            pr: first.pr,
            files: first.files,
            diffText: '+x\n',
            heuristic: first.heuristic,
            notes: ['seeded'],
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      );

      const second = await runCodeReviewLoop({
        number: 3,
        config: cfg,
        checkpointDir: dir,
        runId: 'resume-me',
        resumeFrom: true,
        publish: false,
        runStatic: false,
        llmSummary: 'resumed summary',
        exec: async () => {
          throw new Error('should not fetch again');
        },
      });
      assert.equal(second.resumed, true);
      assert.ok(second.summary?.body.includes('resumed summary'));
      assert.equal(second.pr?.number, 3);
      assert.ok(second.notes.some((n) => /resumed/i.test(n)));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
