# 01: 配置 ${VAR} 展开与 oauth 字段

**What to build:** 用户可以把 API key 放在环境变量里，用 `${VAR}` 引用，不再把它明文写进 `mcp.json` / `.mcp.json`；http server 可以写预注册的 `oauth` 配置。详见 [MCP OAuth spec](../spec.md) 的配置一节。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `url`、`headers` 的值和 stdio `env` 的值中的 `${VAR}` 与 `${VAR:-default}` 在连接前展开；不支持嵌套展开和转义
- [x] 变量缺失且没有默认值时，这个 server 报 `mcp_server_error`，消息中写明变量名；其他 server 不受影响
- [x] http 配置接受 `oauth: { clientId?, clientSecret?, callbackPort?, authServerMetadataUrl? }`：`authServerMetadataUrl` 必须是 https，`callbackPort` 必须是 1–65535 的整数；stdio 配置写 `oauth` 时报配置错误
- [x] 用户层和项目层都适用，项目层仍需 Trusted Project
- [x] 现有 `mcp.test.ts` 不改断言即通过；新 e2e 覆盖展开、默认值、缺变量、`oauth` 校验

## Comments

2026-10-06: 已在 `codex/mcp-oauth-01` 实现配置变量展开与 OAuth 字段校验，基于集成分支 `codex/mcp-oauth` 的 `696e488`。实现位于 `packages/agent/src/mcp/index.ts`；用户及受信任项目配置在 schema 校验后、连接前展开 URL、header 值和 stdio env 值。缺失变量生成包含变量名的服务器错误，其余服务器继续可用。HTTP OAuth 配置校验字段类型、HTTPS metadata URL、端口整数范围；stdio 不接受 OAuth。

TDD 证据：通过公开 `createSession` seam 的新 `packages/agent/tests/e2e/mcp-config.test.ts` 先重现 HTTP `Invalid URL`、stdio `MCP connection closed`、非法 OAuth 配置被接受以及 stdio OAuth 被执行等失败，再逐项实现。原 `mcp.test.ts` 未修改。新测试覆盖用户配置、项目信任、URL/header/env 展开与默认值、三个位置缺变量时隔离错误、OAuth 可选字段/上下界及拒绝非法字段。

验证：`rtk proxy bun test packages/agent/tests/e2e/mcp-config.test.ts packages/agent/tests/e2e/mcp.test.ts`：42 pass / 0 fail；focused oxlint 与 `git diff --check` 通过。使用临时隔离 HOME、清除 NO_COLOR、`caffeinate -is bun run check` 完整检查 exit 0：2221 pass / 0 fail（160 files，293.73s），涵盖 format、lint、types、Knip、测试。日志 `/tmp/neant-mcp-oauth-01-check.log`。MCP 使用文档由集成分支统一在 `docs/mcp.md` 更新。
