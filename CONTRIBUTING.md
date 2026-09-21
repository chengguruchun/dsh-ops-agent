# Contributing

谢谢你愿意一起把「coding agent × DSH 扩展点」这件事说清楚。

## 开发

- Node.js ≥ 22.19  
- `npm install`  
- `npm test`（会先 build `dsh-compaction-guard`）  
- `npm run typecheck`

请保持 **决策层可单测、不依赖本机已安装的 DSH**。接真宿主的脚本放 `fixtures/` / `evidence/`，并在文档里写明 DSH / pi2dsh 版本。

## 提交建议

- 改决策语义：补测试，并同步 `proposals/` 若行为与提案不一致  
- 加 evidence：附触发方式、日志摘要、是否仅 sidecar  
- 文档：中文优先；专有名词保留英文（DSH、compaction、waterfall）

## 行为准则

默认按 [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) 善意协作。严重问题请私下联系维护者。

## 安全

不要在 Issue / PR / evidence 里粘贴密钥、token、内网地址。可疑漏洞请不要公开 Issue，改用维护者邮件或私信。
