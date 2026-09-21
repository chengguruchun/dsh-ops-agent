# An Agent Runtime for Autonomous Operations

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 22.19](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen.svg)](package.json)

> **LLM 决定 what；Runtime 决定 how / when / whether。**
>
> 本仓库不是「工具清单」，而是一套面向自主运维的 **Agent Runtime**：把目标收敛成可门禁、可恢复、可核验的闭环。

```text
discover → diagnose → fix → review(reject) → release → verify
                              ↑                │
                         Risk Gate             ↓
                                         Expected vs Actual Gap
                              ←──── checkpoint / pause / resume ────
```

## 三条保证（Runtime Guarantees）

| 保证 | 含义 | 落点 |
|------|------|------|
| **Execution Gate** | 会不会做、何时做：风险分级 + 自审拒绝 + 审批解锁 | V0.2 Risk Gate · review blockers |
| **Failure Recovery** | 失败后能否继续：retry / 熔断 / 降级 / checkpoint | V0.1 韧性 · V0.3 AgentState · V0.5 pause/resume |
| **Verifiable Closed Loop** | 做完是否真的对：证据链 + Expected vs Actual Gap | V0.3 Evidence/Trace · V0.4 Gap |

---

## 架构（保留）

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
 │  + Runtime V0.2–0.5 │          │  （兄弟域，不嵌套）   │
 └─────────┬───────────┘          └─────────────────────┘
           │
           ▼
 ┌─────────────────────┐
 │  compaction-guard   │
 │  DSH-ARCH-004       │
 └─────────────────────┘
```

**AgentLoop 是 library**：宿主（DSH / pi2dsh）决定模型与会话；本包决定门禁、状态、证据与恢复。  
**不要把 code-review 嵌进 ops loop** —— 它们是 sibling domains，由 plugin 并列注册。

| 域 | Package | 编排 | 工具前缀 |
|----|---------|------|----------|
| Ops | `@dsh-ops-agent/ops-pipeline` | `runOpsClosedLoop` / `runAgentLoop` | `ops_*` |
| Code review | `@dsh-ops-agent/code-review` | `runCodeReviewLoop` | `cr_*` |

---

## Roadmap

| 版本 | 状态 | 内容 |
|------|------|------|
| **V0.1** | ✅ | 真实 adapters + AgentLoop（discover→…→verify）+ retry / checkpoint / 熔断 / 降级 + review 硬停 |
| **V0.2** | ✅ | **Risk Gate** L0–L4（auto / auto+verify / review / approval / human-only），发布前硬停 |
| **V0.3** | ✅ | **Evidence / Trace / AgentState**：Observation→…→Verification IDs，append-only `ExecutionTrace`，checkpoint 存富状态 |
| **V0.4** | ✅ | **Expected vs Actual Gap**：verify 后结构化 gap + `nextActionHint` |
| **V0.5** | ✅ experimental | 长程骨架：内存 EventBus、pause/resume、Domain Registry（ops + code-review） |

详见 [docs/runtime.md](./docs/runtime.md) 与 [docs/closed-loop.md](./docs/closed-loop.md)。

---

## 诚实边界

- **本仓库不做 in-repo LLM codegen**：补丁由 DSH/LLM 宿主通过 `patchFile` / `patchContent` 注入；AgentLoop 负责 workspace git、门禁与发布验证。
- **兄弟域**：ops 与 code-review 并列，不互相吞并。
- **沙箱联调 / 真集群**：待 env；单测全部离线 DI（`exec` / `fetch` / injected actuals）。

---

## 快速开始

需要 Node.js **≥ 22.19**（单测在 ≥ 20 亦可）。

```sh
cp .env.example .env
npm install
npm test
npm run typecheck
```

### AgentLoop 示例

```ts
import { runAgentLoop, loadOpsConfig } from '@dsh-ops-agent/ops-pipeline';

const result = await runAgentLoop({
  alert: rawAlertmanagerWebhook,
  config: loadOpsConfig(),
  goal: '恢复 checkout 错误率',
  runId: 'incident-001',
  coding: {
    workspaceDir: '/tmp/ws-checkout',
    patchContent: unifiedDiffFromLlm,
    commitMessage: 'fix: mitigate crash loop',
  },
  riskApproved: false, // L3 需 OPS_RISK_APPROVED=1 或此标志
  expectedState: { deployment: 'checkout', rolloutComplete: true },
  verify: { deployment: 'checkout', namespace: 'prod' },
});
```

---

## 包说明

| Package | 角色 |
|---------|------|
| `@dsh-ops-agent/ops-pipeline` | Ops 域 + AgentLoop + Runtime V0.2–V0.5 |
| `@dsh-ops-agent/code-review` | Code-review 兄弟域 |
| `@dsh-ops-agent/pi2dsh-plugin` | 注册 `ops_*` + `cr_*` |
| `@dsh-ops-agent/compaction-guard` | 压实前守卫（DSH-ARCH-004） |

---

## DSH + pi2dsh

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add @dsh-ops-agent/pi2dsh-plugin
```

密钥只走环境变量（见 `.env.example`），禁止写入日志或 checkpoint。

---

## License

[MIT](./LICENSE)
