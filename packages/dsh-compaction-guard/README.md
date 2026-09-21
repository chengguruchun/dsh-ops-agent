# @dsh-seam-lab/compaction-guard

Coding agent 场景下的压缩前 **observe / veto / replace** 决策层（`DSH-ARCH-004` lab）。

## 场景

Agent 正在改代码时上下文触顶：希望 **稍稍超标先改完**，或压缩时 **强制保留** `active-file` / `diff` / `failing-test` / `user-constraint`。

Stock DSH **尚无**公开压缩前 waterfall；本包先钉语义与单测。接到真宿主或 sidecar 时再接线。

## 用法

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
```

## 开发

```sh
npm test -w @dsh-seam-lab/compaction-guard
```
