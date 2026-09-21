# DSH-ARCH-003：已有 adapter 最终 request/response 的通用 middleware（stub）

状态：占位 · 第二期  
场景：同样服务 **Coding Agent**（路径脱敏、内网网关 compat、tool 调用审计）  
关联：`pi2dsh` `DSH-ARCH-003`

## 一句话

仓外插件很难增强**已有官方 adapter** 真正发出的最终 request/response；要么整条 transport 自建，要么摸不到线上形态。

## Coding agent 动机（预告）

- 请求里打码绝对路径 / 密钥形态  
- 国内 / 私有网关的 header 与 role compat  
- 出站前审计「即将写入哪些文件」

完整提案待 004 证据链跑通后补；本仓暂不建 `dsh-llm-tap` 包。
