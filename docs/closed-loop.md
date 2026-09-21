# Ops 闭环（`@dsh-ops-agent/ops-pipeline`）

## 阶段图（底层 adapters）

```text
alert  →  logs / metrics  →  kubectl pods/events
  →  GitLab locate (search / file / pipelines)
  →  coding workspace (git clone/branch/patch/commit)
  →  GitLab Issue / MR
  →  docker build / tag / push
  →  release (webhook or script)
  →  verify (rollout status + optional logs)
```

所有 stage 都是**真实适配器**：`kubectl` / `git` / `docker` 或 GitLab/Loki/HTTP。单测注入 `exec` / `fetch` 断言 argv 与 headers，不断真环境。

## AgentLoop（自主闭环）

```text
discover → diagnose → fix → review → release → verify
```

入口：`runAgentLoop(options)`（`packages/ops-pipeline/src/loop/agentLoop.ts`）。

| 阶段 | 做什么 |
|------|--------|
| discover | `normalizeAlert` + 日志（可降级）+ pods/events + 可选 GitLab search → `DiscoveryReport`（hypotheses / errorSignatures / suspectService） |
| diagnose | GitLab project + code search |
| fix | coding workspace：branch + `git apply`（`patchFile` / `patchContent`）；无补丁时记录「待 DSH/LLM 提供」 |
| review | `git diff/status`；空 diff / 密钥模式 → **blockers**；可选 `OPS_REVIEW_COMMAND` |
| release | Issue/MR + image build/push + release trigger（**仅 review.ok**） |
| verify | `kubectl rollout status` + 可选日志回查 |

### 工程韧性

#### Retry（`loop/retry.ts`）

```ts
await withRetry(fn, {
  retries: 2,
  minDelayMs: 50,
  maxDelayMs: 2000,
  jitter: true,
  shouldRetry: (err) => isTransientError(err),
});
```

熔断打开（`CircuitOpenError`）默认不重试。

#### Checkpoint（`loop/checkpoint.ts`）

- 目录：`.ops-checkpoints/`（可用 `checkpointDir` 覆盖；已加入 `.gitignore`）
- 文件：`<runId>.json`，含 `phase`、`report`、`attemptCounts`、`breakerStates`、`context`
- 约定：**阶段成功结束后**落盘；`resumeFrom: true | runId` 时从**下一阶段**继续
- 恢复示例：`runAgentLoop({ runId, resumeFrom: true, alert, coding, ... })`

#### 熔断（`loop/circuitBreaker.ts`）

- 依赖名：`gitlab` / `k8s` / `docker` / `logs` / `release`
- `failureThreshold` 连续失败 → `open` → 冷却 `cooldownMs` → `half-open` 探测一次
- 状态写入 checkpoint，跨进程恢复

#### 降级（`loop/degrade.ts`）

| 场景 | 策略 |
|------|------|
| Loki / HTTP logs 失败 | 回退 `kubectl logs`（需 service/pod） |
| Metrics 未配置或失败 | soft-skip，闭环继续 |
| Release webhook 失败且配置了 script | 可选回退 `OPS_RELEASE_SCRIPT` |
| Review blockers | **硬停止**，不进 release |

### 工具 catalog

新增（供 pi2dsh）：

- `ops_agent_loop_start`
- `ops_agent_loop_resume`
- `ops_self_review`
- `ops_discover`

## 配置

`.env.example` → `.env`。校验按 stage 懒加载（`requireGitlab` 等）。

可选：`OPS_REVIEW_COMMAND`（review 阶段额外 shell，非 0 即 blocker）。

## 与 `runOpsClosedLoop` 的关系

- `runOpsClosedLoop`：线性管道，适合脚本/逐步调用。
- `runAgentLoop`：带门禁与韧性的自主闭环，推荐作为 DSH oncall 主入口。
- 两者共享同一套 stages；降级优先包在 loop/degrade，而不是重写 stage 文件。

## DSH + pi2dsh

1. 注册 `OPS_TOOL_CATALOG`。
2. 模型产出 unified diff → 传入 `patchContent` / `patchFile`。
3. compaction-guard 保留 incident 上下文（DSH-ARCH-004）。
4. 勿把 token 打进日志或 checkpoint。

## Legacy

`ops-sim` **已删除**。勿再引用 demo 包。

## pi2dsh 注册

工具目录通过 `@dsh-ops-agent/pi2dsh-plugin` 注册到 Pi/DSH（见该包 README）。
