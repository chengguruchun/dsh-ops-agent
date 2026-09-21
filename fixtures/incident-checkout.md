# Fixture: checkout-service 5xx 夜间告警

## 注入的 preserveHints

- `incident-id`: INC-2048
- `alert-rule`: checkout-http-5xx
- `failing-service`: checkout-api
- `customer-impact`: checkout 失败率 ~12%
- `recent-logs`: 最近 20 行含 `NullPointerException` @ `PaymentClient`
- `runbook-step`: 2/5（已确认依赖 payment-gateway 延迟升高）

## 期望的 compaction 行为

- 略超 pressure floor → **veto**（继续排查）
- 大幅超标必须压 → **replace**，摘要里不得丢掉上述 hints
