# @dsh-ops-agent/compaction-guard

Pre-compaction **observe / veto / replace** for DeepSeek Harness agents — with first-class **ops / oncall** helpers (coding helpers included).

Maps to host gap **DSH-ARCH-004** (stock DSH still has no public pre-compaction waterfall).

## Ops usage

```ts
import {
  runCompactionGuards,
  defaultOpsAgentGuards,
} from '@dsh-ops-agent/compaction-guard';

const decision = await runCompactionGuards(
  {
    trigger: 'pressure',
    estimatedTokens: 12_000,
    pressureFloor: 10_000,
    sessionId: 'inc-42',
    preserveHints: ['incident-id', 'failing-service', 'recent-logs', 'runbook-step'],
  },
  defaultOpsAgentGuards(),
);
```

`OPS_AGENT_HINTS`: `incident-id` · `alert-rule` · `failing-service` · `recent-logs` · `runbook-step` · `timeline` · `customer-impact`
