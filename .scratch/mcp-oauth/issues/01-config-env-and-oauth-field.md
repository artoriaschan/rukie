# 01: 配置 ${VAR} 展开与 oauth 字段

**What to build:** 用户可以把 API key 放在环境变量里，用 `${VAR}` 引用，不再把它明文写进 `mcp.json` / `.mcp.json`；http server 可以写预注册的 `oauth` 配置。详见 [MCP OAuth spec](../spec.md) 的配置一节。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `url`、`headers` 的值和 stdio `env` 的值中的 `${VAR}` 与 `${VAR:-default}` 在连接前展开；不支持嵌套展开和转义
- [ ] 变量缺失且没有默认值时，这个 server 报 `mcp_server_error`，消息中写明变量名；其他 server 不受影响
- [ ] http 配置接受 `oauth: { clientId?, clientSecret?, callbackPort?, authServerMetadataUrl? }`：`authServerMetadataUrl` 必须是 https，`callbackPort` 必须是 1–65535 的整数；stdio 配置写 `oauth` 时报配置错误
- [ ] 用户层和项目层都适用，项目层仍需 Trusted Project
- [ ] 现有 `mcp.test.ts` 不改断言即通过；新 e2e 覆盖展开、默认值、缺变量、`oauth` 校验
