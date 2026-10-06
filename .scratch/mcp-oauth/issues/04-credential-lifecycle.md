# 04: credential 生命周期

**What to build:** 长时间使用时授权仍然有效：access token 过期后自动刷新；refresh 失效或 server 中途要求重新授权时回到 needs-auth；credential 不会被同名的其他 server 借用；预注册客户端可以用。详见 [MCP OAuth spec](../spec.md) 的 MCP Credential 存储、连接与 needs-auth 两节。

**Blocked by:** 01, 03

**Status:** ready-for-agent

- [ ] token 失效后由 pi 自动刷新，工具调用照常成功（fake 记录到 refresh 请求）；refresh 返回 `invalid_grant` 时 server 回到 needs-auth，伪工具重新出现
- [ ] 工具调用途中遇到 401 / 需要授权：这次调用返回错误，server 标为 needs-auth，下一个 turn 换成伪工具
- [ ] 同名但 url 或 headers 不同的 server 用不到已有的 credential
- [ ] 配置了 `oauth.clientId` 时不调用 `/register`；`clientSecret` 时使用 `client_secret_post`；`callbackPort` 决定回调端口；`authServerMetadataUrl` 跳过元数据发现
- [ ] credentials 文件损坏时发一次 warning、按空处理，下次成功写入前不覆盖原文件
- [ ] 未 trusted 项目 `.mcp.json` 中的 OAuth server 不会被加载，不发生任何 OAuth 请求
- [ ] e2e 覆盖以上各项
