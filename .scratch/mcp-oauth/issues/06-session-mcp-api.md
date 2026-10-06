# 06: MCP 的 Session API

**What to build:** frontend 不用解析错误，也能查看各 MCP server 的状态，并发起登录、登出、重连。详见 [MCP OAuth spec](../spec.md) 的 Session API 一节。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] `mcpServers(): Promise<McpServerView[]>`，字段 `{ name, transport, status: connected | needs-auth | failed, toolCount, auth: oauth | headers | none, error? }`；返回上一个 run 的结果；还没有结果时做一次独立探测（连接、listTools、关闭；不注入 reminder，不写 Transcript）
- [ ] `authenticateMcp(name)`：走 03 的流程；不是 http server 时报错，没有 `onMcpAuth` 时报错
- [ ] `clearMcpAuth(name)`：删除文件中对应的项，并清除 needs-auth 记忆
- [ ] `reconnectMcp(name)`：清除 needs-auth 记忆，重新探测该 server，并更新状态
- [ ] 后三个方法在 run 进行中调用时返回 busy（与 `compact` / `setModel` 一致）；类型放在 `@neant/shared`
- [ ] e2e：第一个 run 前探测，之后返回 run 的结果；clear 后再连接变回 needs-auth；reconnect 后状态更新；busy；预先写好 credentials 文件时 Headless 能直接调用真实工具
