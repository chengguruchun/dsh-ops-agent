# @dsh-ops-agent/ops-pipeline

真实运维闭环适配器 + **AgentLoop**（discover→diagnose→fix→review→release→verify）。

```text
stages: alert → logs/metrics → k8s → GitLab → coding → image → release → verify
loop:   discover → diagnose → fix → review → release → verify
        + retry / checkpoint / circuit-breaker / degrade
```

```sh
npm test -w @dsh-ops-agent/ops-pipeline
```

详见仓库根目录 `README.md` 与 `docs/closed-loop.md`。`ops-sim` 已移除。
