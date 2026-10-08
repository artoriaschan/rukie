# MCP 配置与授权

Agent Core 读取用户的 `~/.rukie/mcp.json`。项目 `.mcp.json` 只在 Trusted Project 中，或明确启用 `trustProjectMcp` 时参与合并；同名项目配置覆盖用户配置。信任与工具权限是独立决定，真实 MCP 工具仍经过 hooks 和 Permission Rule。

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

## Tool Search

Agent Core 用 `toolSearch` 控制 MCP 工具定义是否延迟提供给模型。该字段写在用户 `~/.rukie/settings.json` 或项目 `.rukie/settings.json`，与 `mcp.json` 分开；项目值覆盖用户值，即使项目尚未成为 Trusted Project 也生效。它只控制工具定义的上下文占用，不改变 MCP 配置的信任要求或工具权限。

```json
{
  "toolSearch": "auto"
}
```

| 值             | 行为                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `auto`（缺省） | 候选工具声明的估算 token **超过**模型上下文窗口的 10% 时启用；恰好 10% 不启用。估算为各声明 JSON 字符数之和除以 4。 |
| `on`           | 有候选工具且模型兼容时启用。                                                                                        |
| `off`          | 不延迟新到达的工具。                                                                                                |

模型的 compat 必须声明 `supportsMidConvoToolChanges` 或 `supportsToolSearch` 为真；两者均未启用时，即使设为 `on` 也不启用 Tool Search。候选只包含 MCP 工具，排除 `mcp__<server>__authenticate`；该授权工具遵守既有 Interaction 门槛，在 TUI 可见，在没有授权回调的 Headless CLI 中仍隐藏。内置工具不成为 Deferred Tool。阈值固定，不提供按 server 设置或语义检索。

启用时，模型先通过 `deferred-tools` System Reminder 得到 Deferred Tool 名单，通过 `ToolSearch` 加载需要的定义。名单首次完整提供，之后只追加新增／移除差异；已可用工具从名单移除，Compaction 后补充当前完整名单。`ToolSearch` 的定义固定，不包含这份名单。

`ToolSearch` 接受字符串 `query` 和可选整数 `max_results`（默认 5，范围 1–20）：

- `select:mcp__server__tool,mcp__server__other` 按完整工具名精确选择，不受 `max_results` 数量限制；未知名字列在结果中。
- 其他查询按空白拆成关键词，不区分大小写，在名字与描述中检索；名字命中权重更高，工具名按下划线拆分。`+term` 要求名字包含该词，例如 `+github issue`。
- 结果只列工具名和加载／已可用标记，不复述 schema；无匹配时提示用 `select:`。命中的 Deferred Tool 经 pi 原生工具变更加入当前对话，后续请求可直接调用。

`ToolSearch` 不需要 Interaction 回调，在 Headless CLI 中也可用。它按只读工具处理，Permission Mode 本身不要求询问，显式 Permission Rule 和 hooks 仍生效；搜索只加载定义，调用找到的 MCP 工具仍走正常 Permission Decision。

每次模型请求前重新判定设置、模型和当前候选，只决定尚未可见的工具是否延迟；候选定义占比降低、关闭 Tool Search 或切换模型不会收回已可见的 MCP 工具。`ToolSearch` 一旦出现，在该对话中保留。工具从 MCP 目录移除时也从可见集移除，重新出现时按当时的判定处理；同名定义更新移除旧声明后追加新声明，目录重新排序不移动已有声明。

已可见工具从当前分支的 Transcript 推导，不另存 Tool State。Resume 和 Compaction 保留已发现集，Rewind 回到选定位置的工具可见状态；每个子 Session 独立判定和发现，受自己的工具 allowlist 限制，不继承父 Session 的发现集。启用还要求当前允许的工具目录包含 `ToolSearch`；子类型白名单未允许 `ToolSearch` 时，即使设置为 `on`，白名单允许的 MCP 工具也直接提供给模型，不产生 Deferred Tool 名单，不扩大执行权限。资源连接与 OAuth 的生命周期仍遵循下文约定；架构取舍见 [ADR-0025](adr/0025-client-side-tool-search.md)。

## 登录与连接

TUI 中使用 `/mcp` 打开服务器列表，逐层进入服务器详情、工具列表和工具详情，查看生效配置来源、连接状态、描述与输入 JSON Schema。首次读取显示 loading，完成后自动展示列表；配置文件读取失败与合法服务器同时保留，可在空闲时选择重试。键盘、鼠标、正文阅读和输入锁的用法见 [TUI README](../packages/coding-agent/src/tui/README.md#mcp-管理与授权)。浏览可在 Run 中使用；详情中的登录、登出、重连及配置重试只在空闲时执行，Run 中显示 busy。动作结束后保留详情并显示成功、失败或取消结果。已有 `/mcp login <server>`、`/mcp logout <server>`、`/mcp reconnect <server>` 子命令继续提供相同管理操作。

需要 OAuth 的 server 被标为 `needs-auth`，TUI 每个 Session 提示一次登录命令。连接本身不会打开浏览器；用户执行登录命令或模型调用 `mcp__<server>__authenticate` 后才开始授权。这个工具默认允许执行，仍经过 hooks 和显式 Permission Rule。成功后，它在当前 Run 的下一 Turn 被真实工具替换。

授权面板和审批、问题共用 FIFO 交互队列。面板自动打开浏览器，显示完整 URL，允许复制链接、重新打开浏览器、取消，或粘贴完整回调 URL。本地回调到达时面板自动关闭；回调监听在 `127.0.0.1`，redirect URI 使用 `http://localhost:<port>/callback`。授权等待最多五分钟；取消或 Run 中止按未完成授权处理。授权开始触发 `Notification` hook，`notification_type` 为 `mcp_auth`。

Headless CLI 不提供授权交互，也不向模型暴露 `authenticate` 工具。它提示在 TUI 登录并继续使用其他 server；stream-json 输出 `mcp_auth_required`，登录提示写入 stderr。预期的授权需求不作为 `mcp_server_error`；实际连接或工具错误仍发布该事件。TUI 获得的 MCP Credential 可被后续 Headless Run 复用。

## MCP Credential

MCP Credential 存在 Session 的 `homeDir` 下的 `.rukie/credentials.json`，文件权限为 0600，新建目录权限为 0700。按 server 名、URL 与展开后的 headers 区分，所有 Session 和子代理共用；同名但 URL 或 headers 不同的 server 不能借用。Provider 凭据继续来自环境变量。

写入使用临时文件和 rename。损坏 JSON 被视为空并告警，直到下一次成功写入前保留原文件。pi-mcp 负责 token 刷新；授权失效或需要额外 scopes 时重新回到 `needs-auth`。登出删除本地凭据，不向授权服务器撤销 token。

运行连接属于 Session 宿主，Run 结束后保留未变化的连接。后续 Run 读取当前配置，关闭被移除或配置变化的 server，并更新模型能力；外部 server 自身改变工具或说明时使用显式重连。Session 记住需要授权的 server，避免每次 Run 重复发起未授权请求；登录、登出或重连更新这份状态。子代理的授权交互经父 Session 转发，带上 origin。`session.close()` 关闭连接和未完成的宿主授权资源；Resume 按当前配置建立新连接，不恢复旧 transport。

普通 MCP 工具使用原生 unsafe replay，read-only 或 idempotent 提示不授予自动重放。工具执行后、结果提交前中断时，恢复保留未知结果，不重新调用 server；改变当前工具说明、schema 或提示也不能提升已提交 intent 的重放权限。

## Frontend 接口

Session 暴露 `mcpServers()`、`authenticateMcp(name)`、`clearMcpAuth(name)`、`reconnectMcp(name)`；类型与取消契约以[公共 Session 声明](../packages/agent/src/session/index.ts)和[共享状态类型](../packages/shared/src/mcp.ts)为准。状态中的 `error` 保留原始英文消息；已知 Agent Core 错误另带 `errorData`，Frontend 用它按 locale 呈现。

`mcpServers()` 返回独立副本 `McpSnapshot`，包含 `servers` 与配置文件级 `configErrors`。服务器记录提供生效配置的 `scope`、`configPath`、HTTP `url` 或 stdio `command`，以及真实 MCP 工具的协议名称、完整描述和原始输入 JSON Schema。URL 保留环境变量配置表达式，移除 userinfo、query 和 fragment；快照不包含 headers、env、args、clientSecret 或 MCP Credential。failed/needs-auth 的工具数组为空，`toolCount` 与真实工具数组一致。损坏文件记录来源、路径和错误；缺失文件不算错误，其他合法来源仍可使用，Run 保持 fail-open 和现有警告行为。

快照返回最新提交的状态，包括 Run 连接、同一 Run 授权或失效、管理操作与显式刷新。没有记录时，并发读取复用一次独立探测，发现工具后关闭资源；已有记录时只读缓存，不重新连接或请求工具。调用方修改返回值不会改变 Session 或模型工具声明。`mcpServers({ refresh: true })` 只在空闲时重新读取完整配置并探测，并发刷新复用在途请求；它不自动启动 OAuth 或更改 MCP Credential。Run 中显式刷新及三个管理方法返回 busy 错误。调用方取消管理操作或 `session.close()` 负责收束探测与管理资源，晚到探测不能覆盖较新的 Run 快照。

公开事件 `mcp_servers_changed` 表示新快照已提交，不携带工具 schema；Frontend 收到事件后调用普通 `mcpServers()` 读取缓存。文件级诊断与服务器状态、工具的实际变化都可触发事件；相同快照和缓存读取不重复通知。面板通过这些事件更新，无轮询或后台重连。稳定服务器名与协议工具名保留导航身份；当前工具消失时退回仍有效的工具列表，没有工具时退回服务器详情，服务器消失时退回服务器列表，并显示变化提示。

Frontend 提供 `onMcpAuth` 以显示 Interaction；没有回调时主动登录被拒绝，模型也看不到登录工具。管理面板、选择、阅读位置、结果和授权 UI 都属于 Frontend 本地状态，不写 Transcript、Tool State 或 reminder；Session Resume 不恢复面板。Interaction FIFO 临时接管面板输入，队列处理完后恢复有效页面。关闭、Session 替换或退出清理面板订阅，晚到结果不能重新打开面板或更新另一 Session。

原生认证工具挂起时 close/reopen 会按当前信任和精确 endpoint／headers 配置重新发起授权，替换 listener、state 与 verifier；旧 callback 不能完成新授权。code exchange 开始后仍采用 unsafe 中断语义，不能自动重发已使用或结果未知的 code。请求身份与取消契约见 [Agent Core pending interactions](../packages/agent/README.md#pending-interactions)。

MCP transport 是宿主资源；创建失败、初始化取消和正常 close 均释放已建立的连接。`SessionOptions.initializationSignal` 只约束打开过程，打开后的 transport 生命周期仍由 Session close 和对应操作 signal 管理；不会用启动 signal 取消已接受的后台工作。
