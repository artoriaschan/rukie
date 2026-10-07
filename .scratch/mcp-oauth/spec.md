Status: resolved

# Spec: MCP OAuth 授权

来源：[MCP 远程传输与 OAuth](../agent-core-roadmap/issues/19-mcp-remote-and-oauth.md)。术语见 `CONTEXT.md` 的 MCP Server、MCP Credential、Interaction、Trusted Project、Session、Run、Subagent。参考：pi-mcp `./oauth`（`McpOAuthProvider`、`adaptOAuthProvider`、`OAuthCallbackServer`、`authorizeMcp`、`McpOAuthStateStore`）；Claude Code `src/services/mcp/auth.ts`、`McpAuthTool`；dsh-TUI `/mcp`（`session-controls.ts`、`backendCommands.ts`）与 `dsh-adapter/oauth/interaction.ts`。

## Problem Statement

我想在 Neant 里用 Notion、Linear、Atlassian、Sentry、Figma 这类托管 MCP server。它们只接受浏览器 OAuth 登录，不给 API key。现在我把 url 写进 `mcp.json`，每个 run 只换来一条 "MCP server 出错：401"，没有任何办法登录；模型也不知道这个 server 存在、只是缺授权。就算是接受 API key 的 server，我也只能把 key 明文写进 `.mcp.json`。我还看不到哪些 server 连上了、哪些挂了，只能等它在某次 run 里报错。

## Solution

需要 OAuth 的 server 在连接时被识别为"需要授权"，而不是普通错误。TUI 提示一次 `MCP 服务器 notion 需要授权 · /mcp login notion`；我执行这条命令，或者模型在需要时调用该 server 的 `authenticate` 工具，Neant 打开浏览器并在输入框位置显示授权面板（URL、复制、重开浏览器、取消、粘贴回调 URL）。我在浏览器里授权后，面板自动关闭，server 的真实工具立即可用；凭据保存在本机，之后的 run、session、Headless CLI 和子代理都直接用它。`/mcp` 列出每个 server 的状态和工具数，`/mcp logout|reconnect` 处理凭据和连接。配置里的 `${VAR}` 会展开，API key 可以放在环境变量里。

## User Stories

1. As a TUI user, I want a remote MCP server that answers 401 to be marked as needing authentication instead of failed, so that I know logging in will fix it.
2. As a TUI user, I want a one-time notice `MCP 服务器 <name> 需要授权 · /mcp login <name>` per server per session, so that I learn about it without running `/mcp`.
3. As a TUI user, I want `/mcp login <server>` to start the OAuth flow, so that I can authorize before asking the agent anything.
4. As a TUI user, I want the browser opened automatically when authorization starts, so that I only have to click "allow".
5. As a TUI user, I want the full authorization URL shown in the panel, so that I can open it myself when the browser does not appear.
6. As a TUI user, I want a "copy authorization link" option, so that I can paste a long wrapped URL reliably.
7. As a TUI user, I want an "open browser again" option, so that I can retry after closing the tab.
8. As a TUI user, I want "cancel sign-in", so that I can back out without affecting the run.
9. As a TUI user over SSH, I want to paste the full callback URL from my local browser into the panel, so that authorization works when the local callback server is unreachable.
10. As a TUI user, I want the panel to close by itself when the browser callback arrives, so that I do not have to confirm twice.
11. As a TUI user, I want copy and open-browser results shown in the panel (copied / copy failed / reopened / could not open), so that I know what happened.
12. As a TUI user, I want a success notice `已登录 MCP 服务器 <name>`, so that I know the tools are now available.
13. As a TUI user, I want a clear failure notice with the reason, so that I can fix the server configuration.
14. As a TUI user, I want authorization to give up after 5 minutes, so that a forgotten panel does not block the session forever.
15. As a TUI user, I want the auth panel to share the slot and queue with approvals and questions, so that dialogs never overlap.
16. As a TUI user, I want `/mcp` to list each server with status and tool count, so that I can see what is connected.
17. As a TUI user, I want `/mcp` to tell me which command logs into servers that need auth, so that the next step is obvious.
18. As a TUI user, I want `/mcp` to work during a run, so that I can check status without waiting.
19. As a TUI user, I want `/mcp` before the first run to probe the servers, so that I do not see an empty report.
20. As a TUI user, I want `/mcp` with no servers configured to tell me where to configure them, so that I can get started.
21. As a TUI user, I want `/mcp logout <server>` to delete the stored credential, so that I can switch accounts.
22. As a TUI user, I want `/mcp reconnect <server>` to reconnect a failed server, so that I can recover without restarting.
23. As a TUI user, I want `login`, `logout`, and `reconnect` refused during a run with a clear message, so that a running turn is not disturbed.
24. As a TUI user, I want `/mcp` subcommands and server names completed, so that I do not have to remember them.
25. As a TUI user, I want a usage notice when I omit the server name, so that I learn the syntax.
26. As a model, I want a server that needs authentication to expose `mcp__<server>__authenticate`, so that I know the server exists and can ask the user to log in.
27. As a model, I want `authenticate` to wait until the user finishes and then report success, so that I can use the real tools in my next turn.
28. As a model, I want the server's real tools to replace `authenticate` within the same run after success, so that the task continues without a new prompt.
29. As a model, I want a non-error result when the user cancels, so that I can explain and continue without that server.
30. As a model, I want `authenticate` not to require approval, so that starting a login is not a second prompt.
31. As a TUI user, I want credentials stored in a private file under my home directory, so that I do not log in every session.
32. As a TUI user, I want access tokens refreshed automatically, so that a long session keeps working.
33. As a TUI user, I want an expired or revoked refresh token to lead back to needs-auth instead of a cryptic error, so that I just log in again.
34. As a TUI user, I want a server that asks for more scopes to trigger re-authorization, so that new features work.
35. As a user, I want a credential bound to the server's name, url, and headers, so that a project `.mcp.json` reusing the same name for another url cannot borrow my login.
36. As a user, I want project `.mcp.json` OAuth servers still subject to Trusted Project, so that untrusted repos cannot make me log in somewhere.
37. As a user of a server without dynamic client registration, I want to configure `oauth.clientId` / `clientSecret` / `callbackPort` / `authServerMetadataUrl`, so that pre-registered apps work.
38. As a user, I want `${VAR}` and `${VAR:-default}` expanded in `url`, `headers`, and `env`, so that API keys stay out of committed files.
39. As a user, I want a missing variable without a default reported as a configuration error naming the variable, so that I know what to export.
40. As a Headless CLI user, I want a server that needs auth reported once with "run /mcp login <name> in the TUI", so that the run continues with other servers.
41. As a Headless CLI user, I want credentials obtained in the TUI used automatically, so that scripts can reach OAuth servers.
42. As a stream-json consumer, I want `mcp_auth_required` events, so that wrappers can surface the need to log in.
43. As a subagent model, I want the same `authenticate` tool, with the panel forwarded to the user through the parent, so that delegated work can unlock a server.
44. As a parent session, I want a credential obtained by a subagent to be used in my next run, so that the user logs in once.
45. As a hook author, I want a Notification hook with `notification_type: "mcp_auth"` when authorization starts, so that I can alert myself outside the terminal.
46. As a frontend, I want `mcpServers()`, `authenticateMcp(name)`, `clearMcpAuth(name)`, and `reconnectMcp(name)` on Session, so that I can build MCP controls without parsing errors.
47. As a frontend without an `onMcpAuth` callback, I want `authenticate` tools hidden and `authenticateMcp` rejected, so that nothing waits on an interaction no one can answer.
48. As a TUI user, I want all MCP auth copy in both zh and en, so that the UI matches my locale.

## Implementation Decisions

- **配置（Agent Core `mcp` 模块的 server schema）**：
  - http 配置新增可选的 `oauth: { clientId?, clientSecret?, callbackPort?, authServerMetadataUrl? }`。`authServerMetadataUrl` 必须是 https；`callbackPort` 是 1–65535 的整数。
  - stdio 配置不接受 `oauth`。
  - 在读取并校验配置之后、连接之前，展开 `url`、`headers` 的值和 stdio `env` 的值里的 `${VAR}` 与 `${VAR:-default}`。变量来自 Session 的进程环境。变量缺失且没有默认值时，这个 server 按配置错误报 `mcp_server_error`，消息里写明变量名。不支持嵌套展开和转义。
  - 用户层和项目层都适用；项目层仍然只在 Trusted Project 中加载。
- **MCP Credential 存储（`mcp` 模块内的文件存储，实现 pi `McpOAuthStateStore`）**：
  - 文件为 `<homeDir>/.neant/credentials.json`，权限 0600，所在目录不存在时以 0700 创建。
  - 结构：`{ version: 1, mcp: { [key]: { serverName, serverUrl, state } } }`，其中 `state` 是 pi 的 OAuth 状态（tokens、client information、discovery state、code verifier）。
  - key 为 `<name>|<sha256(JSON{type,url,headers}) 前 16 位>`，`headers` 取展开后的值。
  - 写入方式：先写临时文件再 rename；读到坏 JSON 时当作空，并发一次 warning，不覆盖原文件，直到下次成功写入。
  - 文件只存 MCP Credential；provider 凭据仍然从环境变量读取。
- **连接与 needs-auth**：
  - http server 一律传入由 `McpOAuthProvider`（加上述存储）经 `adaptOAuthProvider` 得到的 authProvider。有 credential 时 pi 自动带上 token 并在需要时刷新，没有时第一个请求按原样发出。
  - connect 时出现以下任一错误，就把 server 标为 needs-auth：`McpAuthRequiredError`、`McpOAuthAuthorizationRequiredError`，或者刷新失败后要求重新授权。
  - needs-auth 时的处理：
    - 不打开浏览器。
    - 不发 `mcp_server_error`，改发 `{ type: "mcp_auth_required", server }`，每个 run 里每个 server 最多一次。
    - 这个 server 只注册伪工具 `mcp__<server>__authenticate`。
  - Session 在内存里记住 needs-auth 的 server key（随 Session 释放）。之后的 run 对这些 server 跳过连接，直接注册伪工具，直到授权成功、`reconnectMcp` 或 `clearMcpAuth`。
  - 工具调用途中遇到 401 / 需要授权：这次工具调用返回错误，server 标为 needs-auth，并在下一个 turn 前把它的工具换成伪工具。
  - 其他错误照旧走 `mcp_server_error`。
  - 连接仍然属于 Run，各 server 串行连接，行为不变。
- **OAuth 流程（Agent Core 拥有，frontend 只负责呈现）**：
  1. 用 pi `OAuthCallbackServer.listen` 启动回调 server：127.0.0.1，`oauth.callbackPort` 或随机端口，路径 `/callback`，超时 5 分钟。redirect_uri 为 `http://localhost:<port>/callback`。
  2. `McpOAuthProvider` 的 `redirectUrl` 指向回调 server；`onRedirect` 记下 authorizationUrl。connect 抛出 `McpOAuthAuthorizationRequiredError` 后，得到 authorizationUrl 与 state。
  3. 调用 `onMcpAuth({ server, authorizationUrl, origin?, signal })`，同时等待回调 server 的 `waitForCallback(state)`，两者谁先完成用谁：
     - 回调 server 先拿到 code：Agent Core abort `signal`，frontend 关闭面板，用这个 code 继续。
     - frontend 先返回 `{ type: "callback-url", url }`：Agent Core 解析出 `code`、`state`、`error` 并校验 state。校验失败时，这次交互按失败处理，错误文本说明 state 不匹配。
     - frontend 返回 `{ type: "cancelled" }`、5 分钟超时，或 run abort：按用户拒绝处理。
  4. 调用 `authorizeMcp(provider, { serverUrl, authorizationCode })` 换取 token，存进文件，关闭回调 server，然后用新的 transport 重连并 `listTools`。
  5. 交互开始时触发 Notification hook，`notification_type: "mcp_auth"`，message 为 `MCP server <name> needs authorization`。
- **Interaction 回调（`SessionOptions` 新增，按地基 A 的方式实现）**：

  ```ts
  onMcpAuth?(request: {
    server: string;
    authorizationUrl: string;
    origin?: InteractionOrigin;
    signal: AbortSignal;
  }): Promise<{ type: "callback-url"; url: string } | { type: "cancelled" }>;
  ```

  - 不进 Transcript。
  - 没有提供时，伪工具不暴露，`authenticateMcp` 直接拒绝。
  - 子代理的请求经父 session 的顶层回调转发，带上 `origin`。

- **伪工具 `mcp__<server>__authenticate`**：
  - 空参数，permission 为 allow，但照常经过 hooks。
  - 描述：`The <server> MCP server is installed but requires authentication. Call this tool to start the OAuth flow; the user completes it in their browser and the server's real tools become available in your next turn.`
  - 执行时走上面的 OAuth 流程，一直挂起到结束。
    - 成功：返回 `Authenticated <server>; its tools are now available.`，并在当前 run 内更新工具集，下一个 turn 起只有真实工具。工具集怎么热替换，实现时以 pi Agent 现有的 `state.tools` / prepareRequest 为准，并加测试覆盖。
    - 用户拒绝：返回 `User did not complete authentication for <server>.`，`isError: false`。
    - OAuth 错误（发现失败、DCR 被拒、token 交换失败）：返回工具错误，附上 pi 的错误消息。
  - 同一个 server 已有授权在进行时，新调用等待并共享同一个结果。
- **Session API（`@neant/agent`，类型放在 `@neant/shared`）**：
  - `mcpServers(): Promise<McpServerView[]>`，`McpServerView = { name, transport: "stdio" | "http", status: "connected" | "needs-auth" | "failed", toolCount, auth: "oauth" | "headers" | "none", error? }`。
    - 返回上一次 run 记录的结果。
    - 还没有记录时，按 run 的规则做一次独立探测：连接、`listTools`、关闭；不注入 reminder，也不写 Transcript。
  - `authenticateMcp(name)`：走同一个 OAuth 流程。不是 http server 时报错；没有 `onMcpAuth` 时报错。
  - `clearMcpAuth(name)`：删除这个 key 的 credential，并清除它的 needs-auth 记忆。
  - `reconnectMcp(name)`：清除 needs-auth 记忆，重新探测这个 server，并更新状态。
  - 后三个方法只能在空闲时调用，run 进行中调用会以 busy 错误拒绝，与 `compact` / `setModel` 一致。
  - 状态变化不另发事件；frontend 在命令完成后读取 `mcpServers()`。
- **Headless CLI**：
  - 不提供 `onMcpAuth`。needs-auth 的 server 发 `mcp_server_error`，error 为 `needs authentication; run /mcp login <name> in the TUI`。
  - stream-json 同时输出 `mcp_auth_required`；text 模式经现有 warning 输出到 stderr。
  - run 照常继续。
- **TUI**：
  - host 新增 `writeClipboard(text): Promise<boolean>`，依次尝试 pbcopy、wl-copy、xclip、xsel、clip.exe。
  - `openExternal(target)` 改为接受 URL 或文件路径：URL 直接交给 `open` / `xdg-open`；文件路径保持现有行为（图片导出后再打开）。
  - `onMcpAuth` 由 interactions 层实现，复用 question 面板组件，和审批、提问共用同一个槽位与 FIFO 队列。
    - 布局：
      - 标题行为 Divider；
      - 第一行 `◈ <server>`，suggestion 色加粗；
      - 问题为 `MCP 服务器 <server> 需要授权`；
      - detail 依次是动作结果、引导语、完整 URL（自动换行）；
      - 选项为复制授权链接 / 重新打开浏览器 / 取消登录；
      - 自定义回答栏用来粘贴回调 URL。
    - 打开面板时调用一次 `openExternal(url)`。打开成功，引导语为 `授权页面已在浏览器打开，请在浏览器中完成登录。` 加 `若页面未打开，请复制下方链接手动访问。`；打开失败，引导语为 `打开以下 URL 完成授权。` 加 `链接较长，换行后不宜手选；可使用复制操作。`。
    - "复制"和"重新打开"不关闭面板，只把结果插到 detail 第一行：`已复制，可粘贴到需要的位置。` / `复制失败；请手动选取文字。` / `已在浏览器重新打开。` / `无法打开浏览器，请改为复制链接。`。
    - "取消"和 Esc 都返回 `cancelled`；提交自定义回答时返回 `callback-url`。
    - `signal` abort 时关闭面板。
    - 没有 spinner，也没有倒计时。
  - 授权结果用 notice：
    - 成功：success 色，4 s，`已登录 MCP 服务器 {{name}}`。
    - 失败：error 色，8 s，`OAuth 登录失败 · {{err}}`。
    - 取消：dim，`已取消 MCP 授权`。
  - `mcp_auth_required`：每个 session 每个 server 只显示一次 warning notice，4 s，`MCP 服务器 {{name}} 需要授权 · /mcp login {{name}}`。
  - 新增内置 Slash Command `/mcp`。
    - 不带参数时，run 进行中也能用。它调用 `mcpServers()`，把一份本地报告写进 transcript：
      - 标题行 `! /mcp`，bashBorder 色，marginTop 1；
      - 内容行 dim，paddingLeft 2：`MCP 服务器（N）`、`{{name}} · {{status}}{{ · N 个工具}}`；
      - 有 needs-auth 时末尾加 `需要授权的服务器请运行 /mcp login <服务器>`；
      - 没有 server 时显示 `没有配置 MCP 服务器` 加一行说明 `~/.neant/mcp.json` 和 `.mcp.json`；
      - 探测进行中时先显示 `正在读取 MCP 状态，稍后再运行 /mcp`。
    - 子命令 `login|logout|reconnect <server>` 只能在空闲时用，分别调用 `authenticateMcp` / `clearMcpAuth` / `reconnectMcp`。
      - 成功 notice：`已登录…` / `已登出 MCP 服务器 {{name}}` / `已重新连接 MCP 服务器 {{name}}`。
      - 失败：`mcp 失败 · {{err}}`。
      - 缺参数时用 warning 显示用法 `用法：/mcp login|logout|reconnect <服务器>`。
      - run 进行中调用时，复用现有命令的 busy 提示。
    - 补全分两层：第一层是子命令（带描述），第二层是 server 名，来自最近一次 `mcpServers()` 的结果。
  - 本地报告的表示：沿用 `/help` 现有的多行 notice 写进 transcript，并按 dsh 的样式渲染：标题行用 bashBorder 色，内容行 dim、缩进 2。如果现有 notice 渲染不出这种样式，就给 notice 加一个 `report` 变体，不新增 transcript 行类型。报告不进 Agent Core Transcript，resume 后不保留。
  - zh 和 en 文案同步。

## Testing Decisions

- **好测试**：只测外部行为，不测 pi-mcp 的 OAuth 内部，也不测存储 key 的计算细节。
  - Agent Core 看这些：模型请求里的工具列表和工具结果、`onMcpAuth` 收到的请求、`mcp_auth_required` / `mcp_server_error` 事件、`mcpServers()` 的返回值、credentials 文件的内容与权限、fake server 收到的请求（是否带 Bearer、是否发生 refresh）。
  - TUI 看终端画面、notice、host 收到的调用。
- **新 fixture**：在 `packages/agent/tests/helpers/` 下用 `Bun.serve` 写一个 fake OAuth + MCP HTTP server。
  - 端点：
    - `/.well-known/oauth-protected-resource`
    - `/.well-known/oauth-authorization-server`
    - `/register`（DCR，可关闭，用来测预注册的 `clientId`）
    - `/authorize`：校验 PKCE 参数，302 到 `redirect_uri`，带上 code 和 state；可配置为返回 `error`
    - `/token`：支持 authorization_code 和 refresh_token；可以让 refresh 返回 `invalid_grant`
    - MCP 端点：没有 Bearer 或 token 过期时返回 401 并带 `WWW-Authenticate: Bearer resource_metadata=…`；有效时提供一个工具
  - 测试可以让当前 access token 失效，并读到请求记录。
  - TUI 测试用相对路径引用它，必要时复制一份精简版。
- **模拟浏览器**：测试注入的 `onMcpAuth` 去 `fetch(authorizationUrl, { redirect: "follow" })`，让 fake `/authorize` 的 302 打到 pi 的本地回调 server，再等待 `signal` abort。测粘贴路径时，回调直接拼出 `http://localhost:<port>/callback?code=…&state=…` 返回。
- **Agent Core e2e**（`bun:test`，`createSession` + `fakeModel` + `tempDirs`，新文件如 `tests/e2e/mcp-oauth.test.ts`）：
  - 没有 credential：run 中模型请求里只有 `mcp__srv__authenticate`；发出 `mcp_auth_required`，没有 `mcp_server_error`；浏览器没被打开（`onMcpAuth` 没被调用）。
  - 模型调用 authenticate，经回调完成授权：工具结果为成功文案，下一次模型请求里出现真实工具、没有伪工具，真实工具调用成功；credentials 文件存在且权限是 0600。
  - 粘贴回调 URL 完成授权；state 不匹配时报错；`cancelled`、超时（缩短超时或依靠 abort）、run abort 都返回非错误的拒绝结果，run 继续。
  - 新 session 复用 credential，直接连上，不再调用 `onMcpAuth`。
  - token 过期后自动 refresh（fake 记录到 refresh 请求），工具调用照常成功；refresh 返回 `invalid_grant` 时回到 needs-auth。
  - 工具调用途中遇到 401：这次调用返回错误，下一个 turn 换成伪工具。
  - credential 隔离：同名、不同 url 的 server 用不到已有的 credential。
  - 预注册：`oauth.clientId` 配置下不调用 `/register`；`callbackPort` 生效。
  - `${VAR}` / `${VAR:-default}` 在 url、headers、env 中展开；变量缺失时报配置错误。
  - 没有 `onMcpAuth`：伪工具不暴露，`authenticateMcp` 被拒绝。
  - Session API：`mcpServers()` 在第一个 run 之前探测，之后返回上一个 run 的结果；`authenticateMcp`、`clearMcpAuth`（文件中这一项被删除，再连时变回 needs-auth）、`reconnectMcp`；run 进行中调用这三个时返回 busy。
  - 同时有两个 authenticate 调用时，只发生一次交互。
  - 子代理：拿到伪工具，`onMcpAuth` 的请求带 `origin`；授权后父 session 的下一个 run 直接可用。
  - Notification hook 收到 `mcp_auth`。
  - 未 trusted 的项目 `.mcp.json` 中的 OAuth server 不会被加载。
- **Headless CLI**（`apps/neant-cli/tests/main.test.ts`）：needs-auth 时 stream-json 里有 `mcp_auth_required` 和带提示文案的 `mcp_server_error`，run 正常结束；预先写好 credentials 文件时直接调用真实工具。
- **TUI e2e**（`start` + headless terminal + 注入 host，新文件如 `tests/e2e/mcp.test.ts`）：
  - needs-auth notice 每个 session 只出现一次。
  - `/mcp login srv`：面板布局、`openExternal` 收到 URL；"复制"调用 `writeClipboard` 并显示结果行；"重新打开"再次调用 `openExternal`；`openExternal` 失败时显示手动打开的引导语；本地回调到达后面板自动关闭，并出现成功 notice。
  - 粘贴回调 URL 完成授权；Esc 或"取消"显示取消 notice。
  - 授权面板和审批面板同时到来时按 FIFO 排队。
  - `/mcp` 报告：各种状态行、needs-auth 提示行、空状态、首次 loading；run 进行中也能执行；`login` / `logout` / `reconnect` 在 run 进行中显示 busy；缺参数时显示用法；补全显示子命令和 server 名。
  - 模型调用 authenticate 时出现同一个面板。
  - zh / en 文案；小终端（40×12）下 URL 能换行，面板不溢出。
- **参考先例**：Agent Core `tests/e2e/mcp.test.ts`（内联 `Bun.serve` 的 Streamable HTTP、项目信任、abort）、`questions.test.ts`（挂起等待交互的工具）、`notification-hooks.test.ts`、`subagent-permissions.test.ts`（带 `origin` 转发）；TUI `questions.test.ts` / `question-panel-parity.test.ts`（面板与 Ctrl+V 粘贴）、`permissions.test.ts`（槽位排队）、`tools-and-notices.test.ts`、`images.test.ts`（`openExternal` 注入）。
- host 的 `writeClipboard` 与 `openExternal(URL)` 默认实现不做自动化测试，实现时在 macOS 上手动验证并记录。另外用一个真实托管 server（如 Notion 或 Linear 的 MCP）手动走一遍完整流程，记录在工单中。

## Out of Scope

- legacy HTTP+SSE 与 WebSocket 传输（pi-mcp 不支持）。
- `headersHelper`（运行命令生成 header）。
- 设备码流程、client credentials、XAA / 企业 IdP。
- 系统 keychain / Secret Service 存储。
- RFC 7009 token 撤销；跨进程刷新锁。
- Headless CLI 的 `neant mcp login` 子命令或控制请求。
- `/mcp toggle on|off`，以及配置里的 enabled 开关。
- 全屏 MCP 管理面板（Claude Code 的 `/mcp` 菜单）。
- MCP 工具卡显示成 `server › tool`：归 [TUI 工具卡复刻 dsh-TUI](../agent-core-roadmap/issues/20-tui-tool-card.md)。
- 启动时并行连接、后台自动重连与指数退避；连接仍然按 Run 进行。

## Further Notes

- credentials 文件是明文，安全性取决于 0600 权限和用户 home 目录本身，和 Claude Code 在非 macOS 平台、Codex 在没有 keyring 时的做法相同。存储层单独封装，以后要换 keychain 只改这一层。
- 进程内的并发刷新由 pi 合并成一次；TUI 和 Headless 同时刷新同一个 credential 时，可能有一方的 refresh token 失效而要重新登录，可以接受。
- `redirect_uri` 用 `localhost`、回调 server 绑定 `127.0.0.1`，照 Claude Code 的做法。如果某个授权服务器只接受 `127.0.0.1` 写法，再考虑加配置。
- 连接属于 Run，所以每个 run 开始时都会读 credentials 文件，token 也会在 run 开始时按需刷新；needs-auth 记在内存里，避免每个 run 都重复发一次 401 请求。
- 本 spec 没有修改 ADR-0002：OAuth 协议复用 pi-mcp，Neant 只实现 pi 明确留给调用方的部分（浏览器、存储、重连）。

## Comments

- 2026-10-06：在 `codex/mcp-oauth` 集成分支实施，起点 `696e488`。按依赖图为每张票创建独立受管理 worktree，由实现子代理完成后集成。公共测试边界沿用本 spec 的 Testing Decisions。
- 基线验证：按锁文件安装依赖；临时 HOME 下运行 `env -u NO_COLOR bun run check`，exit 0，2201 pass、0 fail（159 个文件）。最初未安装依赖时检查因找不到 oxfmt 退出；实际 HOME 下的首轮测试已停止，以上通过结果来自隔离后的完整重跑。
- 2026-10-06：01–08 的代码实现已进入 `codex/mcp-oauth`；审查修复集成提交 `ca35ecd3d25c4eeea9b815d4066cda801161363e`。08 的真实账户完整授权验收仍单独记录，不以模拟 server 的通过替代。
- 两轴独立审查以 `696e488` 为固定起点：Standards 发现一项已知错误本地化问题及一项重复 needs-auth 状态构造的判断性建议；Spec 发现回调草稿覆盖所选操作、同一 Run 登录后的追加 scopes 丢失。一个实现代理在 `41cd0ff` 统一修复，两个原审查代理复核均确认全部解决，无新增问题；Spec 独立回归 12 pass、0 fail。
- 最终完整验证：修复 worktree 的隔离 HOME 下运行 `env -u NO_COLOR bun run check`，exit 0，2309 pass、0 fail、11818 assertions，166 files（308.73 s），format、lint、types、Knip 全通过。初次修复检查只有一个原有中文测试仍期望英文前缀失败；仅同步该文案断言，保留通知颜色、单行、次数和 Transcript 断言后完整重跑。日志 `/tmp/neant-mcp-oauth-review-check.log`，旧日志 `/tmp/neant-mcp-oauth-review-check-before-localized-expectation.log`。
- 合并验证：集成 `HEAD` 与完整测试提交的 Git tree 完全相同（`c1adfded797e110ba728c9067eff771e86a1f5d4`）；集成工作区另跑 212 pass、0 fail、933 assertions 的公开组合测试及 format、lint、types、Knip，全部通过。日志 `/tmp/neant-mcp-oauth-review-integration.log`。后续交付记录与使用说明只修改 Markdown，单独验证格式与引用。
- 清理：8 个工单 worktree 和 1 个审查修复 worktree 均先核对干净、提交已集成，再通过 Codex 归档；9 个归档附件已确认，集成工作区保留，其他功能 worktree 未改动。
- 真实 Notion 尝试已验证 `/mcp` 的 needs-auth 报告、无模型调用、授权面板及系统浏览器打开；未完成账号授权，也未收到成功回调，临时 HOME、项目和凭据已清除。真实登录后的凭据复用、logout / reconnect 链路仍待用户完成账号操作，详见 [08 的验收记录](issues/08-tui-mcp-command.md)。01–07 resolved，08 和本 spec 保留 ready-for-human；没有把真实账号验收记为通过。
- 2026-10-06：按用户要求将 `codex/mcp-oauth` 快进合并到 `main`（`942bfd0`）。在主检出目录的隔离 HOME 下重新运行 `env -u NO_COLOR bun run check`，exit 0，2309 pass、0 fail、11818 assertions，166 files（315.56 s），format、lint、types、Knip 全通过；日志 `/tmp/neant-mcp-oauth-main-check.log`。08 的真实账号验收仍为 ready-for-human。
- 2026-10-07：用户确认 08 的真实账号验收已通过；08 和本 spec 改为 resolved。
