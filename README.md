# dsh-seam-lab

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 22.19](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen.svg)](package.json)

面向 **Coding Agent** 的实验仓：在 **DeepSeek Harness（DSH，Cordis 宿主）+ `pi2dsh`（Pi 扩展桥）** 架构上，补齐 / 验证宿主仍缺的公开扩展点。

> 第一期焦点：**DSH-ARCH-004** — 压缩（compaction）执行前的 observe / veto / replace。  
> 第二期占位：**DSH-ARCH-003** — 已有 LLM adapter 的最终 request/response middleware。

本仓库 **不 fork** DSH 或 `pi2dsh`；先用纯决策层 + 提案把语义钉死，再对接 stock 宿主与上游讨论。

## 为什么开源

Agent 框架越来越像「可插拔运行时」：模型、工具、会话、压缩、子代理都该是插件。DSH 用 Cordis 把这条路走得很彻底；`pi2dsh` 又把成熟的 Pi coding 生态接进来。

真正卡住 coding agent 体验的，往往不是「会不会调工具」，而是 **上下文生命周期**：一压缩，失败测试栈、当前 diff、用户约束就没了。本仓把这类缺口写成可测试的决策语义 + 可提交上游的提案，方便社区复现和讨论。

## 架构一眼看懂

```text
┌─────────────────────────────────────────────┐
│  DeepSeek Harness (Cordis host + agent loop) │
│    tools · sessions · compaction · llm …     │
│              ▲                               │
│              │ 普通 DSH 插件                  │
│         ┌────┴────┐                          │
│         │  pi2dsh │  实现 Pi 扩展 ABI         │
│         └────┬────┘                          │
│              │ 原样加载 npm                    │
│     Pi coding 生态包（工具 / MCP / 子代理…）   │
└─────────────────────────────────────────────┘
                    ▲
                    │ 提案 + 决策原型 + evidence
              dsh-seam-lab（本仓）
```

一句话：**DSH 管宿主与生命周期，Pi 生态管 coding 能力，`pi2dsh` 做翻译；本仓推进「压缩前仍能改决定」这类宿主 seam。**

## 这套架构能做哪些 Agent？（面试 / 方案口述也适用）

在「DSH 宿主 + pi2dsh 桥」上，能力组合大致是：**会话与压缩在宿主、编码动作在 Pi 插件、权限与可观测走 DSH 服务**。可落地的 agent 形态例如：

| 类型 | 做什么 | 主要靠什么 |
|------|--------|------------|
| **仓库结对编程 Agent** | 读改跑测、解释 diff、按约束改某一包 | Pi 文件/shell 工具 + DSH 会话 |
| **PR / MR 修好 Agent** | 拉 CI 失败日志、最小 diff 修复、回写评论 | Git/CI MCP 或工具 + 子会话 |
| **测试驱动修复 Agent** | 红灯 → 定位 → 改代码 → 再跑 | `failing-test` 保留 + bash/test |
| **迁移 / 重构 Agent** | 跨文件改 API、批量替换、保证类型检查过 | 代码导航类 Pi 包 + 长会话压缩策略 |
| **安全审计 Agent** | 扫依赖与危险调用，出报告不乱改 | 只读工具 +（003）出站审计 middleware |
| **Oncall / 日志排查 Agent** | 查日志、复现、提修复 PR | MCP + 子代理分工 |
| **多代理协作** | 规划 / 实现 / 审查分角色 | DSH 子会话 + Pi subagents（经桥） |
| **团队规范 Agent** | 强制 lint、目录边界、禁止改 API | `user-constraint` + 压缩前 replace |

面试时可以补一句边界：

- **适合**：工具多、会话长、要热插拔能力的 coding / 运维类 agent  
- **还痛的点**：压缩前不能 veto/replace（本仓 004）、增强官方 adapter 的最终请求（003）、部分持久事件仍要 sidecar  
- **和「单进程脚本套 LLM」的差别**：宿主管生命周期与组合，桥管生态复用，插件可卸载可替换

## 目录

```text
dsh-seam-lab/
├── proposals/
│   ├── DSH-ARCH-004-pre-compaction-waterfall.md
│   └── DSH-ARCH-003-llm-middleware.md
├── packages/
│   └── dsh-compaction-guard/     # observe / veto / replace 决策层
├── fixtures/                     # 长会话改代码剧本（建设中）
└── evidence/                     # stock DSH 复现材料（建设中）
```

## 快速开始

需要 **Node.js ≥ 22.19**。

```sh
git clone <this-repo> dsh-seam-lab
cd dsh-seam-lab
npm install
npm test
```

核心 API 直觉（coding agent）：

```ts
import {
  runCompactionGuards,
  vetoWhileEditing,
  replaceWhenPreserving,
  codeAgentPreservePlan,
} from '@dsh-seam-lab/compaction-guard';

const decision = await runCompactionGuards(ctx, [
  vetoWhileEditing({ maxOverFloor: 512 }),
  replaceWhenPreserving(codeAgentPreservePlan),
]);
// decision: observe | veto | replace
```

约定中的 `preserveHints`：`active-file` · `diff` · `failing-test` · `user-constraint` · `open-pr`。

## 现状与非目标

**已有**

- 004 提案草案（coding agent 动机）  
- `@dsh-seam-lab/compaction-guard` 纯函数决策层 + 单测  
- 003 提案占位  

**没有 / 不做（当前）**

- 不宣称 DSH 已提供压缩前 waterfall  
- 不内嵌 DSH / pi2dsh 源码  
- 不把 sidecar 演示说成「原生 seam 已闭合」  

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。Issue / PR 欢迎，尤其是：

1. stock DSH 上「压缩丢掉 failing-test / diff」的最小复现（`evidence/`）  
2. 对 004 API 命名与 overflow 语义的反对意见  
3. coding agent 剧本 fixtures  

## 许可

[MIT](./LICENSE)

## 相关链接

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)  
- [pi2dsh](https://github.com/weijiafu14/pi2dsh)  
- [Pi coding agent](https://pi.dev/)  
- [Cordis](https://github.com/cordiverse/cordis)
