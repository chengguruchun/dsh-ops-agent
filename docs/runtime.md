# Agent Runtime（V0.2–V0.5）

定位：在 `@dsh-ops-agent/ops-pipeline` 内实现 **Execution Gate · Failure Recovery · Verifiable Closed Loop**。  
LLM 仍只负责 *what*；本层负责 *how / when / whether*。

## V0.2 Risk Gate

模块：`src/runtime/riskGate.ts`

| Level | 默认策略 | 典型动作 |
|-------|----------|----------|
| L0 | auto | read-only |
| L1 | auto_verify | git commit、docker build、开 issue |
| L2 | review | docker push、release trigger、开 MR |
| L3 | approval | helm upgrade、kubectl apply/scale、git push |
| L4 | human_only | kubectl delete、helm uninstall、secret touch |

`runAgentLoop` 在 **release** 前调用 `evaluateRiskGate` → `assertRiskAllowed`；deny / 未批准的 approval 会硬停并写入 `agentState.riskDecisions`。

环境变量：`OPS_RISK_APPROVED` / `OPS_RISK_L3_UNLOCK` / `OPS_RISK_HUMAN_UNLOCK`。  
测试可注入 `riskAction` / `riskApproved` / `skipRiskGate`。

## V0.3 Evidence · Trace · AgentState

- IDs：`Observation` / `Evidence` / `Decision` / `Action` / `Result` / `Verification`
- `ExecutionTrace`：append-only 事件流
- `AgentState`：goal、phase、上述列表、`lastRisk` / `lastGap`、`paused`
- Checkpoint JSON 增加 `agentState` 字段，可 round-trip

## V0.4 Expected vs Actual Gap

模块：`src/runtime/gap.ts`

`computeGap(expected, { actual | fetchActual })` → `{ ok, items, summary, nextActionHint }`。  
AgentLoop 在 verify 成功拿到 rollout 后计算 gap；blockers 会使闭环 `failed`。  
测试用 `injectedActualState` / `expectedState` DI。

## V0.5 Skeleton（experimental）

- `InMemoryEventBus`：`agent.checkpoint` / `agent.pause` / `agent.resume` / `agent.risk_denied` / `agent.gap`
- `pauseAfterPhase` + checkpoint `agentState.paused` → `resumeFrom` 清 pause
- `DomainRegistry` / `createDefaultDomainRegistry()`：注册 `ops` 与 `code-review`（不嵌套）

这些是长程 / 多域骨架，尚未做分布式调度或持久化事件存储。
