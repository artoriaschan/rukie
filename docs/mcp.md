# MCP 配置与授权

Agent Core 读取用户的 `~/.neant/mcp.json`。项目 `.mcp.json` 只在 Trusted Project 中，或明确启用 `trustProjectMcp` 时参与合并；同名项目配置覆盖用户配置。信任与工具权限是独立决定，真实 MCP 工具仍经过 hooks 和 Permission Rule。

## 配置

两层配置都使用 `mcpServers` 对象。stdio server 使用 `command`、可选的 `args` 和 `env`；Streamable HTTP server 使用 `url`、可选的 `headers` 和 `oauth`。

```json
{
  "mcpServers": {
    "remote": {
      "url": "${MCP_URL}",
      "headers": { "Authorization": "Bearer ${MCP_API_KEY}" }
    },
    "oauth-server": {
      "url": "https://mcp.example.com/mcp",
      "oauth": { "clientId": "registered-client", "callbackPort": 8765 }
    },
    "local": {
      "command": "my-mcp-server",
      "env": { "API_KEY": "${LOCAL_API_KEY:-development}" }
    }
  }
}
```

`url`、`headers` 的值和 stdio `env` 的值在连接前从当前进程环境展开 `${VAR}` 与 `${VAR:-default}`。不支持嵌套展开或转义；缺少变量且没有默认值时，仅该 server 报配置错误，消息包含变量名。`command` 与 `args` 不展开。

http 的可选 `oauth` 配置接受 `clientId`、`clientSecret`、`callbackPort` 和 `authServerMetadataUrl`。`clientId` 用于预注册客户端，配合 `clientSecret` 使用 `client_secret_post`。`callbackPort` 必须是 1–65535 的整数；省略时使用随机端口。`authServerMetadataUrl` 必须使用 HTTPS。stdio 不接受 `oauth`。

## 登录与连接

TUI 中使用 `/mcp` 查看状态及工具数，使用 `/mcp login <server>` 登录、`/mcp logout <server>` 删除本地 MCP Credential、`/mcp reconnect <server>` 重试连接。报告可在 Run 中查看，三个子命令只能在空闲时执行。

需要 OAuth 的 server 被标为 `needs-auth`，TUI 每个 Session 提示一次登录命令。连接本身不会打开浏览器；用户执行登录命令或模型调用 `mcp__<server>__authenticate` 后才开始授权。这个工具默认允许执行，仍经过 hooks 和显式 Permission Rule。成功后，它在当前 Run 的下一 Turn 被真实工具替换。

授权面板和审批、问题共用 FIFO 交互队列。面板自动打开浏览器，显示完整 URL，允许复制链接、重新打开浏览器、取消，或粘贴完整回调 URL。本地回调到达时面板自动关闭；回调监听在 `127.0.0.1`，redirect URI 使用 `http://localhost:<port>/callback`。授权等待最多五分钟；取消或 Run 中止按未完成授权处理。授权开始触发 `Notification` hook，`notification_type` 为 `mcp_auth`。

Headless CLI 不提供授权交互，也不向模型暴露 `authenticate` 工具。它提示在 TUI 登录并继续使用其他 server；stream-json 输出 `mcp_auth_required` 和带登录提示的 `mcp_server_error`。TUI 获得的 MCP Credential 可被后续 Headless Run 复用。

## MCP Credential

MCP Credential 存在 Session 的 `homeDir` 下的 `.neant/credentials.json`，文件权限为 0600，新建目录权限为 0700。按 server 名、URL 与展开后的 headers 区分，所有 Session 和子代理共用；同名但 URL 或 headers 不同的 server 不能借用。Provider 凭据继续来自环境变量。

写入使用临时文件和 rename。损坏 JSON 被视为空并告警，直到下一次成功写入前保留原文件。pi-mcp 负责 token 刷新；授权失效或需要额外 scopes 时重新回到 `needs-auth`。登出删除本地凭据，不向授权服务器撤销 token。

连接属于 Run：结束时关闭，下次 Run 重新发现工具。Session 记住需要授权的 server，避免每次 Run 重复发起未授权请求；登录、登出或重连更新这份状态。子代理的授权交互经父 Session 转发，带上 origin。

## Frontend 接口

Session 暴露 `mcpServers()`、`authenticateMcp(name)`、`clearMcpAuth(name)`、`reconnectMcp(name)`；类型与取消契约以[公共 Session 声明](../packages/agent/src/session/index.ts)和[共享类型](../packages/shared/src/index.ts)为准。

`mcpServers()` 返回上一次 Run 的状态；没有记录时独立连接、发现工具并关闭，不写 Transcript 或注入 reminder。后三个方法在 Run 中返回 busy 错误。Frontend 提供 `onMcpAuth` 以显示交互；没有回调时主动登录被拒绝，模型也看不到登录工具。交互、状态报告和登录 UI 不进入 Agent Core Transcript。
