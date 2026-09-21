# DSH-ARCH-004：压缩执行前的取消 / 替换 waterfall

状态：草案（lab）  
场景定位：**Coding Agent**（改仓库 / 跑测试 / 出 diff），不是通用闲聊  
关联：`pi2dsh` 架构结论中的 `DSH-ARCH-004`  
本仓实现：`packages/dsh-compaction-guard`

## 问题（用 coding agent 说）

Coding agent 会话天然又臭又长：反复 `read` / `edit` / `bash`、贴测试日志、夹用户约束。DSH 会在 pressure 或 context-overflow 时压缩历史。

今天仓外插件 **很难在压缩执行前** 介入决策，结果常见是：

1. 刚跑红的测试栈被摘要成「跑过测试」  
2. 未提交 diff 的关键 hunk 消失，下一步改错文件  
3. 用户说的「只改 `packages/foo`」被压没，agent 开始全局乱动

`pi2dsh` 写明：sidecar 能绕 ≠ 宿主公开 seam 完整。Coding agent 比闲聊更需要 **veto / replace** 这种硬扩展点。

| 触发 | 入口 | 插件今天大致能做什么 |
|------|------|----------------------|
| pressure | `agent/pre-step` | 感知压力相关时机，但缺少公开的压缩前 cancel/replace waterfall |
| context-overflow | `agent/request-error` | 主机驱动恢复；仓外难以改写压缩计划 |
| compactNow | 显式维护 | 同上 |

## Coding agent 想保住的 `preserveHints`（约定草案）

| hint | 含义 |
|------|------|
| `active-file` | 当前正在 edit 的路径 |
| `diff` | 工作树或会话内累积 diff 摘要 |
| `failing-test` | 最近失败用例与关键栈 |
| `user-constraint` | 用户明确约束（目录、禁止改 API 等） |
| `open-pr` | 关联 PR / MR 编号与检查状态 |

本仓 `replaceWhenPreserving` 已按「有 hints → replace plan」建模，具体序列化格式留给接真宿主时再钉。

## 非目标

- 不要求模型用 tool 触发压缩  
- 不重做 token 计量  
- 本期不实现 `DSH-ARCH-003`（但对「请求里打码路径 / 审计 tool 调用」很有用）  
- 不把 Pi 私有事件写进 DSH 原生日志（`DSH-ARCH-001`）

## 提议的公开 seam（假说）

压缩真正 summarizer / 写 checkpoint **之前**，增加 awaited waterfall，例如 `compaction/before`：

```ts
type CompactionBeforeEvent = {
  trigger: 'pressure' | 'context-overflow' | 'compact-now'
  estimatedTokens: number
  pressureFloor: number
  sessionId: string
  defaultPlan: CompactionPlan
  // coding agent 可选：由桥或插件注入
  preserveHints?: string[]
}

// 监听器：next() | veto/skip | replace(plan)
```

约束建议：

1. **pressure**：允许 veto（短暂超标先改完当前文件再压）与 replace（换 directive，强制保留 hints）。  
2. **context-overflow**：默认不允许无条件 veto；允许更激进的 replace。  
3. 同一 turn / surface generation 只决策一次。  
4. 决策可观测，便于 `evidence/` 与 pi2dsh 证据链。

## 成功标准

- [ ] 上游有文档化的压缩前 waterfall（或等价能力）  
- [ ] Coding 向仓外插件可在允许的触发上 veto/replace，而无需实现整套 compaction  
- [ ] 复现剧本证明：有 seam 时 `failing-test` / `diff` 在压缩后仍可被后续步骤使用  
- [ ] `pi2dsh` 可将 004 从「缺口」推进到有证据的承接等级  

## 参考

- pi2dsh `docs/dsh-architecture-conformance.md`  
- DSH compaction 子系统文档  
- 本仓 `packages/dsh-compaction-guard`
