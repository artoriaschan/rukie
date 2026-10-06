# 19: MCP 远程传输与 OAuth

Type: grilling
Status: resolved
Blocked by: 01

## Question

支持 SSE / Streamable HTTP 传输与 OAuth 认证的远程 MCP server。

需定：settings 中 MCP server 配置形状扩展（`url`、`headers`、传输类型）；OAuth 流程（本地回调端口 / 设备码）、token 存储位置与刷新；授权交互走地基 A（TUI 打开浏览器、Headless CLI 如何处理）；连接失败与重连在 MCP server 错误通知中的呈现。先确认所用 MCP SDK 已支持的部分。

## Answer

2026-10-06 grilling 结论：以 Claude Code 为蓝本；OAuth 协议部分复用 pi-mcp `./oauth`（发现、DCR / CIMD、PKCE、刷新、回调 server）；TUI 复刻 dsh-TUI（`/mcp` 本地报告 + LLM OAuth 登录所复用的提问面板）。`CONTEXT.md` 新增 **MCP Credential** 词条，并补充 **MCP Server** 词条。参考：Claude Code 还原源码 `src/services/mcp/`、`McpAuthTool`；Codex `codex mcp login`；dsh-TUI `/mcp` 与 `dsh-adapter/oauth/interaction.ts`。

### 现状与范围

1. Neant 已支持 stdio 和 Streamable HTTP，HTTP 可以带静态 `headers`。本工单只补 OAuth、`${VAR}` 展开和 MCP 状态界面。
2. 不做的部分：legacy SSE / WebSocket（pi-mcp 不支持，主流托管 server 都已提供 Streamable HTTP）、`headersHelper`、设备码、client credentials、keychain、RFC 7009 撤销、跨进程刷新锁、Headless 登录子命令。

### 配置

3. http 配置新增可选字段 `oauth: { clientId?, clientSecret?, callbackPort?, authServerMetadataUrl? }`，用于没有 DCR 的 server。
4. `url`、`headers`、stdio 的 `env` 支持展开 `${VAR}` 与 `${VAR:-default}`。

### 认证流程

5. **触发**：连接时遇到 401（包括 `McpAuthRequiredError`、`McpOAuthAuthorizationRequiredError`），不打开浏览器，只做以下几件事：
   - 把 server 标为 needs-auth，记在内存里，session 内不再重复连接，不落盘。
   - 当前 run 里这个 server 的真实工具换成伪工具 `mcp__<server>__authenticate`。
   - 发事件 `mcp_auth_required { server }`，每个 run 里每个 server 最多发一次。
   - 连接失败等其他错误继续走 `mcp_server_error`。
6. **Interaction**（地基 A）：`onMcpAuth({ server, authorizationUrl, origin?, signal }) → { type: "callback-url", url } | { type: "cancelled" }`。
   - Agent Core 负责回调 server（pi `OAuthCallbackServer`）、PKCE 和 state 校验。
   - 本地回调先到时，Agent Core 通过 `signal` 结束这次交互；frontend 返回粘贴的回调 URL 时，由 Agent Core 解析并校验。
   - 5 分钟超时，超时与取消都按用户拒绝处理，不影响 run。
   - 交互开始时触发 Notification hook，`notification_type: "mcp_auth"`。
   - 没有提供这个回调时，伪工具不暴露给模型。
7. **伪工具**：
   - 空参数，不需要审批。工具描述改写自 Claude Code 原文。
   - 调用后一直挂起，直到交互结束，和 `ask_user_question` 一样。
   - 成功：在当前 run 内重连这个 server，从下一个 turn 起换回真实工具，返回 `Authenticated <server>; its tools are now available.`。
   - 取消或超时：返回 `User did not complete authentication for <server>.`，不算错误。
   - run 中途替换工具集的做法，实现时用 pi Agent 验证。
8. **存储**：
   - 实现文件版的 `McpOAuthStateStore`：`~/.neant/credentials.json`，权限 0600。
   - 键为 `name|sha256(type,url,headers)` 的前 16 位。
   - 内容包括 tokens、client information 和 discovery state。
   - 存储层单独封装，以后要换 keychain 只改这一层。
9. **刷新与登出**：
   - 刷新交给 pi-mcp：并发 401 共享同一次刷新，`invalid_grant` 时清掉 tokens，403 `insufficient_scope` 时重新授权。
   - 登出只删除本地 credential。
10. **子代理**：共用同一个 credentials 文件；子代理同样拿到伪工具，Interaction 经顶层回调转发并带上 `origin`；子代理授权成功后，父 session 也能用。
11. **Headless CLI**：
    - 不提供 `onMcpAuth`，伪工具不暴露。
    - 需要授权的 server 发 `mcp_server_error`，内容为 `needs authentication; run /mcp login <name> in the TUI`，run 照常继续。
    - stream-json 输出 `mcp_auth_required`。
    - 在 TUI 登录后，credential 与 Headless 共享。

### Session API

12. Session 新增以下方法：
    - `mcpServers()`：列出各 server 的名称、传输方式、状态（connected / needs-auth / failed）、工具数、认证方式。取上一次 run 的连接结果，没有结果时探测一次。
    - `authenticateMcp(name)`：走同一个 Interaction。
    - `clearMcpAuth(name)`、`reconnectMcp(name)`。
    - 后三个只能在空闲时调用。

### TUI（复刻 dsh-TUI）

13. **`/mcp`**：照 dsh，写一份本地报告进 transcript。
    - 标题行 `! /mcp` 用 bashBorder 色。内容行用 dim，`paddingLeft 2`：`MCP 服务器（N）`、`name · status · N 个工具`。
    - 有 needs-auth 的 server 时，末尾加一行 `需要授权的服务器请运行 /mcp login <服务器>`。
    - 还没有状态时显示 loading 文案，并在后台探测；空状态显示配置路径的说明。
    - run 进行中也能执行。
14. **子命令**：`/mcp login|logout|reconnect <server>`，只能在空闲时执行；补全分两层，第一层是子命令，第二层是 server 名。dsh 的 `toggle` 不做。结果用 notice 反馈：
    - 成功：success 色，4 s。
    - 失败：error 色，8 s，`mcp 失败 · {{err}}`。
    - 参数不全：warning 色，显示用法。
15. **授权对话框**：复用现有的 question 面板，和审批、提问共用同一个槽位、统一 FIFO 排队。
    - 布局照 dsh 的 OAuth 登录：`◈ <server>`，detail 里是引导语和完整 URL；选项为复制授权链接 / 重新打开浏览器 / 取消登录，自定义回答栏用来粘贴回调 URL。
    - 复制和打开浏览器的结果插在 detail 第一行，文案照 dsh 原文。浏览器打不开时，引导语换成手动打开的提示。
    - 本地回调到达后自动关闭。
    - 静态显示，没有 spinner。
    - 结果用 notice：成功 `已登录 MCP 服务器 {{name}}`，失败 `OAuth 登录失败 · {{err}}`，取消 `已取消 MCP 授权`。
16. **host**：新增 `writeClipboard(text)`（pbcopy / wl-copy / xclip / xsel）；`openExternal` 扩展到支持 URL。
17. **needs-auth 提示**：dsh 没有这个提示，这里是新增的。warning 色 notice，4 s，`MCP 服务器 {{name}} 需要授权 · /mcp login {{name}}`，每个 session 每个 server 只提示一次。
18. zh 和 en 文案同步。MCP 工具卡的 `server › tool` 显示归 [TUI 工具卡复刻 dsh-TUI](20-tui-tool-card.md)。

Spec：[MCP OAuth 授权](../../mcp-oauth/spec.md)
