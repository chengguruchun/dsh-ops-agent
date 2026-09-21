# dsh-ops-agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 22.19](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen.svg)](package.json)

**运维 / Oncall Agent** monorepo —— 面向 **DeepSeek Harness（DSH / Cordis）+ [pi2dsh](https://github.com/weijiafu14/pi2dsh)**。

目标不是「演示模拟器」，而是一套可在沙箱里真正调 `kubectl` / `git` / `docker` / GitLab HTTP 的**自主闭环**：

```text
discover → diagnose → fix → review → release → verify
```

告警进来后，Agent 从日志 + K8s 事件发现可疑点，定位仓库，应用补丁（由 DSH/LLM 提供），**自审通过后才放行发布**，再做 rollout 验证。

> `ops-sim` 本地 demo 包已**删除**，不再维护。唯一闭环路径是 `@dsh-ops-agent/ops-pipeline`。

---

## 架构

```text
┌─────────────────────────────────────────────────────────┐
│              DeepSeek Harness (Cordis)                  │
│     agent loop · sessions · compaction · llm · perms    │
└──────────────────────────▲──────────────────────────────┘
                           │ DSH plugin
                    ┌──────┴──────┐
                    │   pi2dsh    │  Pi 扩展 ABI / tool catalogs
                    └──────┬──────┘
                           │ @dsh-ops-agent/pi2dsh-plugin 注册
           ┌───────────────┴────────────────┐
           │                                │
           ▼                                ▼
 ┌─────────────────────┐          ┌─────────────────────┐
 │  ops-pipeline       │          │  code-review        │
 │  OPS_TOOL_CATALOG   │          │  CR_TOOL_CATALOG    │
 │  stages + AgentLoop │          │  CodeReviewLoop     │
 │  （运维闭环）         │          │  （PR/MR 评审，兄弟域）│
 └─────────┬───────────┘          └─────────────────────┘
           │
           ▼
 ┌─────────────────────┐
 │  compaction-guard   │
 │  DSH-ARCH-004       │
 └─────────────────────┘

外部依赖（真实 CLI/HTTP，可 DI）：
  kubectl · git · docker · GitLab API · Loki/HTTP logs · release webhook
  gh / glab · GH_TOKEN / GITLAB_TOKEN · CR_REVIEW_COMMAND
```

**兄弟域（sibling domains）—— code-review 不嵌在 ops loop 里：**

| 域 | Package | 编排 | 工具前缀 |
|----|---------|------|----------|
| Ops | `@dsh-ops-agent/ops-pipeline` | `runOpsClosedLoop` / `runAgentLoop` | `ops_*` |
| Code review | `@dsh-ops-agent/code-review` | `runCodeReviewLoop`（fetch→analyze→static?→summarize→publish?） | `cr_*` |

Plugin **只负责注册**；深度 LLM 评审由 DSH 宿主注入 `llmSummary` / `reviewNotes`。

**Ops 两层编排：**

| 层 | API | 用途 |
|----|-----|------|
| 阶段管道 | `runOpsClosedLoop` | 按阶段跑通 alert→…→verify，缺配置则 skip |
| **AgentLoop** | `runAgentLoop` | 自主闭环：发现→诊断→修复→**自审门禁**→发布→验证，带 retry / checkpoint / 熔断 / 降级 |

---

## 自主闭环（AgentLoop）

```text
discover  合成 DiscoveryReport（alert + logs + pods/events + 可选 GitLab search）
    ↓
diagnose  GitLab 定位（search / project）
    ↓
fix       coding workspace：clone/branch/`git apply`（patchFile 或 patchContent）
    ↓
review    自审：非空 diff、无密钥模式、可选 OPS_REVIEW_COMMAND
    ↓         ✗ blockers → 硬停止，不进 release
release   Issue/MR + docker build/push + webhook/script
    ↓
verify    kubectl rollout status + 可选回查日志
```

### 工程韧性（已实现，不是文档空话）

| 能力 | 模块 | 行为 |
|------|------|------|
| **Retry** | `loop/retry.ts` | `withRetry`：可配 attempts / minDelay / maxDelay / jitter；默认识别 transient（5xx、timeout、ECONN*） |
| **Checkpoint** | `loop/checkpoint.ts` | 每阶段结束后写入 `.ops-checkpoints/<runId>.json`（phase、report、attemptCounts、breaker 状态）；`resumeFrom` 从下一阶段继续 |
| **熔断** | `loop/circuitBreaker.ts` | 依赖（gitlab / k8s / docker / logs / release）连续失败 N 次 → open，冷却期内 fail-fast，半开探测 |
| **降级** | `loop/degrade.ts` | Loki/HTTP 日志失败 → kubectl logs；metrics 缺失/失败 soft-skip；release webhook 失败可回退 script；**review 失败硬停** |

**补丁从哪来？** 本仓库**不内置 LLM 改代码**。DSH / pi2dsh 宿主通过 tool 传入 `patchFile` 或 `patchContent`；AgentLoop 负责 workspace 的 git 操作与后续门禁。这是诚实边界，不是半成品口号。

---

## 包说明

| Package | 角色 |
|---------|------|
| `@dsh-ops-agent/ops-pipeline` | **Ops 域**：真实闭环适配器 + AgentLoop + 韧性原语 + `OPS_TOOL_CATALOG` |
| `@dsh-ops-agent/code-review` | **Code-review 兄弟域**：gh/glab fetch、启发式、静态检查、评论发布 + `CR_TOOL_CATALOG`（深度 LLM 评审在 DSH 宿主） |
| `@dsh-ops-agent/pi2dsh-plugin` | **Pi 扩展**：经 pi2dsh 注册 `ops_*` + `cr_*`（含 compaction-guard 钩子）；只注册，不嵌套域逻辑 |
| `@dsh-ops-agent/compaction-guard` | 压实前守卫（DSH-ARCH-004），避免 oncall 上下文被丢掉 |
| ~~`ops-sim`~~ | **已移除** |

---

## 快速开始

需要 Node.js **≥ 22.19**（单测在 ≥ 20 亦可）。

```sh
cp .env.example .env   # 有沙箱端点时再填
npm install
npm test
npm run build
npm run typecheck
```

`npm test` **完全离线**：`exec` / `fetch` 可注入，不断真集群。

### 编程调用示例

```ts
import { runAgentLoop, loadOpsConfig } from '@dsh-ops-agent/ops-pipeline';

const result = await runAgentLoop({
  alert: rawAlertmanagerWebhook,
  config: loadOpsConfig(),
  runId: 'incident-001',
  coding: {
    workspaceDir: '/tmp/ws-checkout',
    repoUrl: 'https://gitlab.example/group/checkout.git',
    branch: 'fix/ops-incident-001',
    patchContent: unifiedDiffFromLlm, // DSH 提供
    commitMessage: 'fix: mitigate crash loop',
  },
  image: { contextDir: '/tmp/ws-checkout', imageName: 'checkout', tag: 'ops-001' },
  verify: { deployment: 'checkout', namespace: 'prod' },
  issue: { labels: ['ops', 'incident'] },
  mergeRequest: { sourceBranch: 'fix/ops-incident-001', title: 'fix: ops incident' },
});

// 崩溃后恢复
await runAgentLoop({
  alert: rawAlertmanagerWebhook,
  runId: 'incident-001',
  resumeFrom: true,
  coding: { workspaceDir: '/tmp/ws-checkout', /* 同前 */ },
});
```

工具名（供 pi2dsh 注册）：`ops_agent_loop_start` / `ops_agent_loop_resume` / `ops_self_review` / `ops_discover`，以及既有的 `ops_query_logs`、`ops_run_closed_loop` 等。见 `packages/ops-pipeline/src/tools/catalog.ts`。

---

## Code review 兄弟域

```text
fetch → analyze (heuristics) → optional static (CR_REVIEW_COMMAND) → summarize → optional publish
```

- 包：`@dsh-ops-agent/code-review`（`CodeReviewLoop`，**不**嵌在 ops AgentLoop 内）
- 工具：`cr_fetch_pr` / `cr_list_files` / `cr_heuristic_review` / `cr_run_checks` / `cr_post_comment` / `cr_review_loop_start`
- 启发式：secrets、huge diff、missing tests、TODO density
- 宿主可注入 `llmSummary` / `reviewNotes`；深度语义评审仍在 DSH

详见 [packages/code-review/README.md](./packages/code-review/README.md)。

---


---

## DSH 侧路由（动态选工具）

自由选工具发生在 **DSH 宿主 LLM**，不在各域 loop 内部：

```text
请求
  ├─（可选）分类器 / 规则：运维 | code-review | 其它
  │         → 收窄可见工具集，或指定域 loop
  └─ DSH LLM：在已注册 tools 里动态选择
        → pi2dsh → pi2dsh-plugin
              ├─ ops_*  → ops-pipeline（原子 stage 或 AgentLoop）
              └─ cr_*   → code-review（原子工具或 CodeReviewLoop）
```

- **原子工具**：宿主可单步调用（如只查日志、只拉 PR diff）。
- **域 Loop**：宿主也可一把调用 `ops_agent_loop_start` / `cr_review_loop_start`；loop 内部是固定相位编排（含 skip / 降级 / 熔断），不是第二套自由 router。
- **编码器分类模型**：可作为 DSH 前置门禁（便宜分类 → 再交给 LLM），与当前插件模型兼容，**本仓库未内置**；默认路径是宿主 LLM 直接路由。

## DSH + pi2dsh 接入

正式入口：`@dsh-ops-agent/pi2dsh-plugin`（Pi 包，`pi.extensions` → `registerOpsTools`，同时注册 ops + code-review）。

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add @dsh-ops-agent/pi2dsh-plugin
# 开发期可用本地路径：
# dsh plugin --profile web add /path/to/dsh-ops-agent/packages/pi2dsh-plugin
# 然后重启 dsh
```

行为：

1. 按 Pi tool ABI 注册全部 `OPS_TOOL_CATALOG` + `CR_TOOL_CATALOG`（handlers 调真实 stage / loop；配置来自 `OPS_*` / `CR_*` / `GH_TOKEN` / `GITLAB_TOKEN`）。
2. Oncall session：模型决定何时 `ops_discover` → 生成补丁 → `ops_agent_loop_start`（或分步调 stage tools）。
3. Code-review session：`cr_fetch_pr` / `cr_heuristic_review` / 宿主 LLM 摘要 → `cr_review_loop_start`（可选 `cr_post_comment`）。
4. 可选挂 `session_before_compact` → `@dsh-ops-agent/compaction-guard`（Pi ABI 经 pi2dsh；原生 DSH-ARCH-004 仍可能不完整）。
5. 密钥只走环境变量（`OPS_GITLAB_TOKEN`、`OPS_DOCKER_PASSWORD`、`GH_TOKEN`、`GITLAB_TOKEN`），**禁止写入日志或 checkpoint**。

详见包内 [packages/pi2dsh-plugin/README.md](./packages/pi2dsh-plugin/README.md) 与 [docs/closed-loop.md](./docs/closed-loop.md)。

---

## 诚实现状

| 项 | 状态 |
|----|------|
| 真实 CLI/HTTP 适配器 + 离线 DI 单测 | ✅ |
| AgentLoop（discover→…→verify） | ✅ |
| Retry / Checkpoint / 熔断 / 降级 | ✅（代码 + 单测） |
| Review 门禁（密钥/空 diff/可选命令） | ✅ |
| Ops compaction-guard | ✅ |
| Code-review 兄弟域（fetch/heuristics/publish） | ✅ `@dsh-ops-agent/code-review` |
| pi2dsh 注册 `ops_*` + `cr_*` | ✅ `@dsh-ops-agent/pi2dsh-plugin` |
| DSH 宿主动态路由（LLM 选 tool / 可选前置分类器） | ✅ 架构支持；分类器未内置 |
| 沙箱联调（真集群 + registry） | ❌ 待 env |
| 真机 `gh`/`glab` 鉴权联调 | ❌ 待 `GH_TOKEN` / `GITLAB_TOKEN` |
| 内置 LLM 自动生成补丁 / 深度 PR 评审 | ❌ **刻意不做** —— 由 DSH 宿主提供 |
| 上游 DSH-ARCH-004 合入证据 | ❌ 待推进 |

---

## License

[MIT](./LICENSE)
