# 03: 模型触发 OAuth 授权（端到端）

**What to build:** 模型调用 `mcp__<server>__authenticate`，Agent Core 经 `onMcpAuth` 请用户在浏览器授权。授权完成后，server 的真实工具在当前 run 的下一个 turn 即可用，MCP Credential 保存到本机，之后的 session 直接复用。详见 [MCP OAuth spec](../spec.md) 的 MCP Credential 存储、OAuth 流程、Interaction 回调、伪工具四节。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] 文件存储实现 `McpOAuthStateStore`：`<homeDir>/.neant/credentials.json`，权限 0600，目录不存在时以 0700 创建；结构 `{ version: 1, mcp: { [key]: { serverName, serverUrl, state } } }`；key 为 `name|sha256(type,url,headers) 前 16 位`；先写临时文件再 rename
- [ ] 流程：启动 `OAuthCallbackServer`（127.0.0.1、随机端口、`/callback`、5 分钟），redirect_uri 为 `http://localhost:<port>/callback`；拿到 authorizationUrl 后调用 `onMcpAuth`，同时等待回调；本地回调先到时 abort `signal`；收到粘贴的 `callback-url` 时解析并校验 state
- [ ] `authorizeMcp` 换取 token 后存储；关闭回调 server；用新的 transport 重连并 `listTools`；从下一个 turn 起真实工具替换伪工具。工具集的热替换方式按 pi Agent 现状实现，并有测试覆盖
- [ ] 结果：成功返回 `Authenticated <server>; its tools are now available.`；`cancelled`、超时、run abort 返回 `User did not complete authentication for <server>.`（`isError: false`），run 继续；OAuth 错误返回工具错误
- [ ] 同一个 server 已有授权在进行时，新的调用共享同一个结果；交互开始时触发 Notification hook，`notification_type: "mcp_auth"`
- [ ] e2e（注入的 `onMcpAuth` 去 fetch 授权 URL 来模拟浏览器）：完成授权，下一次模型请求只有真实工具、调用成功、文件内容和权限正确；粘贴路径；state 不匹配；取消；abort；并发两次调用只发生一次交互；新 session 复用 credential、不调用 `onMcpAuth`
