# `@dsh-ops-agent/pi2dsh-plugin`

Pi extension that registers **sibling domain** tool catalogs for **DeepSeek Harness via [pi2dsh](https://github.com/weijiafu14/pi2dsh)**:

- `OPS_TOOL_CATALOG` → `@dsh-ops-agent/ops-pipeline`
- `CR_TOOL_CATALOG` → `@dsh-ops-agent/code-review`

```text
DSH (Cordis) → pi2dsh → this package
                           ├─ ops-pipeline (+ compaction-guard)
                           └─ code-review   (sibling; not nested in ops loop)
```

## Install under DSH

```sh
# once
dsh plugin --profile web add pi2dsh

# from a linked / published build of this monorepo package
dsh plugin --profile web add @dsh-ops-agent/pi2dsh-plugin
# or file: path while developing:
# dsh plugin --profile web add /path/to/dsh-ops-agent/packages/pi2dsh-plugin

# restart so plugins remount
dsh --profile web
```

Requires Node ≥ 22.19 on the DSH host, plus `OPS_*` / `CR_*` / forge token env vars (see repo `.env.example`).

## Programmatic API

```ts
import { registerOpsTools } from '@dsh-ops-agent/pi2dsh-plugin';

registerOpsTools(pi, {
  config: loadOpsConfig(),           // or omit → process.env
  crConfig: loadCodeReviewConfig(),  // or omit → process.env
  exec: myExec,                      // DI for tests / sandboxes
  enableCompactionGuard: true,
  enableCodeReview: true,            // default true
  preserveHints: ['incident-id', 'failing-service', 'recent-logs'],
});
```

## Tools

**Ops** (`ops_*`): stage tools, `ops_run_closed_loop`, AgentLoop (`ops_agent_loop_start` / `_resume`), `ops_discover`, `ops_self_review`.

**Code review** (`cr_*`): `cr_fetch_pr`, `cr_list_files`, `cr_heuristic_review`, `cr_run_checks`, `cr_post_comment`, `cr_review_loop_start`.

Deep LLM PR review stays on the DSH host; `code-review` is fetch / heuristics / publish.

## Compaction (DSH-ARCH-004)

This plugin hooks Pi’s `session_before_compact` (available through pi2dsh) to `@dsh-ops-agent/compaction-guard`.

## Develop

```sh
npm install
npm test -w @dsh-ops-agent/pi2dsh-plugin
npm run typecheck -w @dsh-ops-agent/pi2dsh-plugin
```
