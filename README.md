# dsh-ops-agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 22.19](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen.svg)](package.json)

**运维 / Oncall Agent** 实验项目：跑在 **DeepSeek Harness（DSH / Cordis）+ [pi2dsh](https://github.com/weijiafu14/pi2dsh)** 上。

> 告警 → 查日志 / 指标 / runbook → 定位 → 缓解或修代码。  
> 上下文变长触发压缩时，**不能丢掉 incident、失败服务、关键日志**。

第一期：压缩前 **observe / veto / replace**（`DSH-ARCH-004`），按 oncall 约定 `preserveHints`。

## 架构

```text
DeepSeek Harness (Cordis)
  agent loop · sessions · compaction · llm · permissions
        ▲
        │ DSH plugin
     pi2dsh  ←── Pi extension ABI
        │
  Pi tools / MCP / subagents（日志、kubectl、Grafana…）
        ▲
   dsh-ops-agent（本仓：决策语义 + 提案 + evidence）
```

## 能做什么

| 能力 | 说明 |
|------|------|
| 告警接入 | Alertmanager / PagerDuty 类事件（MCP 或 webhook 工具） |
| 排查 | 日志、指标、K8s 事件、最近变更 |
| Runbook | 逐步执行，记录 `runbook-step` |
| 缓解 | 回滚、扩容、开关、临时配置 |
| 可选修代码 | 同一桥上挂 coding 工具，从 oncall 切到 PR |
| 压缩保护 | `vetoWhileInvestigating` / `opsAgentPreservePlan` |

## 包

| 包 | 作用 |
|----|------|
| `@dsh-ops-agent/compaction-guard` | 压缩前决策（通用 + coding + **ops**） |

Ops hints：`incident-id` · `alert-rule` · `failing-service` · `recent-logs` · `runbook-step` · `timeline` · `customer-impact`

```ts
import {
  runCompactionGuards,
  defaultOpsAgentGuards,
} from '@dsh-ops-agent/compaction-guard';

await runCompactionGuards(ctx, defaultOpsAgentGuards());
```

## 快速开始

需要 Node.js **≥ 22.19**。

```sh
git clone https://github.com/chengguruchun/dsh-ops-agent.git
cd dsh-ops-agent
npm install
npm test
```

## 文档

- [DSH-ARCH-004](./proposals/DSH-ARCH-004-pre-compaction-waterfall.md)
- [DSH-ARCH-003 stub](./proposals/DSH-ARCH-003-llm-middleware.md)
- [Incident fixture](./fixtures/incident-checkout.md)
- [Contributing](./CONTRIBUTING.md)

## 现状

- [x] 仓库更名与 ops 叙事
- [x] ops compaction guards + 单测
- [ ] stock DSH + pi2dsh 端到端 demo
- [ ] 真实告警 / 日志 MCP 装配示例
- [ ] 上游 seam evidence

## License

[MIT](./LICENSE)
