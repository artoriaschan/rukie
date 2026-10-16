# MCP 配置与授权

Agent Core 读取用户的 `~/.rukie/mcp.json`。项目 `.mcp.json` 只在 Trusted Project 中，或明确启用 `trustProjectMcp` 时参与合并；同名项目配置覆盖用户配置。信任与工具权限是独立决定，真实 MCP 工具仍经过 hooks 和 Permission Rule。

## 配置

两层配置都使用 `mcpServers` 对象。stdio server 使用 `command`、可选的 `args`、`env` 和 `cwd`；Streamable HTTP server 使用 `url`、可选的 `headers` 和 `oauth`。

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

`url`、`headers` 的值以及 stdio 的 `args`、`env`、`cwd` 在连接前从当前进程环境展开 `${VAR}` 与 `${VAR:-default}`。`${RUKIE_PROJECT_DIR}` 是保留变量，取当前项目根目录。`command` 不展开。不支持嵌套展开或转义；缺少变量且没有默认值时，仅该 server 报配置错误，消息包含变量名。

用户级 server 默认是进程级全局单例；stdio 在配置 `cwd` 或 `homeDir` 启动，不再隐式使用项目目录。依赖项目目录的用户级配置应在 `args`、`env` 或 `cwd` 中使用 `${RUKIE_PROJECT_DIR}`，使每个项目拥有独立实例。项目 `.mcp.json` 的 server 也按项目实例化。项目实例的 stdio 使用配置 `cwd` 或项目根目录；相对 `cwd` 从所属的 home 或项目根目录解析。快照的 `scope` 和 `configPath` 表示配置来源，不表示连接作用域：引用项目目录的用户级 server 仍显示为全局来源。

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
| `on`           | 有候选工具时启用。                                                                                                  |
| `off`          | 不延迟新到达的工具。                                                                                                |

Tool Search 使用普通工具调用，不要求模型声明原生工具追加能力。Responses 和 Messages 的原生追加能力未声明时，Rukie 在第一次需要追加工具的请求前独立探测，确认支持才使用原生格式；显式关闭、检测不支持或结果未知时，适配器将已加载工具加入下一次请求的顶层 `tools` 列表。显式完整开启能力时跳过探测。`compat` 选择传输方式，不决定 Tool Search 是否启用。

候选只包含 MCP 工具，排除 `mcp__<server>__authenticate`；该授权工具遵守既有 Interaction 门槛，在 TUI 可见，在没有授权回调的 Headless CLI 中仍隐藏。内置工具不成为 Deferred Tool。阈值固定，不提供按 server 设置或语义检索。

### 自定义模型的 compat

用户可在 `~/.rukie/settings.json` 的 `providers[].models[].compat` 配置所选 API 的兼容性字段。字段按 provider 的 `api` 校验，未知字段、错误类型或其他 API 的字段会报告配置文件及字段路径；完整字段见 [ModelCompatSchemas](../packages/shared/src/model-compat.ts)。除下文的原生追加检测外，未设置字段沿用适配器默认行为；显式值优先于推断，显式 `false` 可关闭对应能力。项目配置不能定义或覆盖 provider。

支持原生对话内工具追加的 Anthropic Messages 服务可使用以下配置；`baseUrl`、环境变量名与模型 ID 换成服务实际值，环境变量中保存 API key：

```json
{
  "model": "custom/my-model",
  "toolSearch": "on",
  "providers": [
    {
      "id": "custom",
      "api": "anthropic-messages",
      "baseUrl": "https://api.example.com",
      "apiKeyEnv": "CUSTOM_API_KEY",
      "models": [
        {
          "id": "my-model",
          "compat": {
            "supportsMidConvoSystemMessages": true,
            "supportsMidConvoToolChanges": true
          }
        }
      ]
    }
  ]
}
```

对支持原生 Tool Search 追加格式的 `openai-responses` 服务，将对应模型的 `compat` 设为 `{ "supportsToolSearch": true, "supportsMidConvoSystemMessages": true }`。`openai-completions` 的兼容性字段也可配置，例如 `{ "maxTokensField": "max_tokens", "supportsStore": false }`；使用普通 `tools` 列表的 Tool Search 无需这些能力标记。这些字段可省略，让 Rukie 按实际响应检测。显式声明应匹配服务端实际协议，Rukie 不会将 Chat Completions 服务转换成 Messages 或 Responses 服务。

### 原生追加能力检测

探测是独立模型请求，不进入 Session Transcript、恢复输入、任务遥测回调或 Session 用量。它发送合成工具追加并要求调用新增工具，收到对应调用才确认支持；探测工具不会执行。只有 Responses 和 Messages 在确实需要追加工具时触发，普通聊天不会探测。首次检测会增加一次模型请求和服务端费用，最长等待 10 秒；取消任务也取消探测。

检测结果与探测 token／费用估算单独保存在 `~/.rukie/model-capabilities.json`，按 endpoint、API、provider、model、凭据和 headers 指纹隔离。同进程并发共享检测；支持缓存 24 小时、不支持缓存 1 小时、未知缓存 60 秒，取消不形成有效缓存。文件不保存凭据、endpoint 或原始错误响应；缓存损坏或不可写时提示警告并继续任务。

只有 HTTP 400/422 明确拒绝原生追加或对话内 system 格式才判定不支持。网络、认证、限流、服务端错误或未调用探测工具只记为未知，当前请求回退到普通 `tools`；缓存过期后可重新探测。真实任务请求在输出内容前遇到明确的原生格式拒绝时，回退重试一次；其他错误、已有输出或取消不触发该重试。相关所有权与恢复边界见 [ADR-0027](adr/0027-native-tool-capability-probing.md)。

修改配置后启动新 Session 验证：在 `toolSearch: "on"` 且存在 MCP 候选时，初始工具列表包含 `ToolSearch`，MCP 工具在搜索发现后才向模型声明。

启用时，模型先通过 `deferred-tools` System Reminder 得到 Deferred Tool 名单，通过 `ToolSearch` 加载需要的定义。名单首次完整提供，之后只追加新增／移除差异；已可用工具从名单移除，Compaction 后补充当前完整名单。`ToolSearch` 的定义固定，不包含这份名单。

`ToolSearch` 接受字符串 `query` 和可选整数 `max_results`（默认 5，范围 1–20）：

- `select:mcp__server__tool,mcp__server__other` 按完整工具名精确选择，不受 `max_results` 数量限制；未知名字列在结果中。
- 其他查询按空白拆成关键词，不区分大小写，在名字与描述中检索；名字命中权重更高，工具名按下划线拆分。`+term` 要求名字包含该词，例如 `+github issue`。
- 结果只列工具名和加载／已可用标记，不复述 schema；无匹配时提示用 `select:`。命中的 Deferred Tool 经 pi 原生工具变更加入当前对话，后续请求可直接调用。

`ToolSearch` 不需要 Interaction 回调，在 Headless CLI 中也可用。它按只读工具处理，Permission Mode 本身不要求询问，显式 Permission Rule 和 hooks 仍生效；搜索只加载定义，调用找到的 MCP 工具仍走正常 Permission Decision。

每次模型请求前重新判定设置、模型和当前候选，只决定尚未可见的工具是否延迟；候选定义占比降低、关闭 Tool Search 或切换模型不会收回已可见的 MCP 工具。`ToolSearch` 一旦出现，在该对话中保留。工具从 MCP 目录移除时也从可见集移除，重新出现时按当时的判定处理；同名定义更新移除旧声明后追加新声明，目录重新排序不移动已有声明。

已可见工具从当前分支的 Transcript 推导，不另存 Tool State。Resume 和 Compaction 保留已发现集，Rewind 回到选定位置的工具可见状态；每个子 Session 独立判定和发现，受自己的工具 allowlist 限制，不继承父 Session 的发现集。启用还要求当前允许的工具目录包含 `ToolSearch`；子类型白名单未允许 `ToolSearch` 时，即使设置为 `on`，白名单允许的 MCP 工具也直接提供给模型，不产生 Deferred Tool 名单，不扩大执行权限。资源连接与 OAuth 的生命周期仍遵循下文约定；架构取舍见 [ADR-0025](adr/0025-client-side-tool-search.md) 与 [ADR-0026](adr/0026-protocol-independent-tool-search.md)。

## 登录与连接

TUI 中使用 `/mcp` 打开服务器列表，逐层进入服务器详情、工具列表和工具详情，查看生效配置来源、连接状态、描述与输入 JSON Schema。首次读取显示 loading，完成后自动展示列表；配置文件读取失败与合法服务器同时保留，可在空闲时选择重试。键盘、鼠标、正文阅读和输入锁的用法见 [TUI README](../packages/coding-agent/src/tui/README.md#mcp-管理与授权)。浏览可在 Run 中使用；详情中的登录、登出、重连及配置重试只在空闲时执行，Run 中显示 busy。动作结束后保留详情并显示成功、失败或取消结果。已有 `/mcp login <server>`、`/mcp logout <server>`、`/mcp reconnect <server>` 子命令继续提供相同管理操作。

需要 OAuth 的 server 被标为 `needs-auth`，TUI 每个 Session 提示一次登录命令。连接本身不会打开浏览器；用户执行登录命令或模型调用 `mcp__<server>__authenticate` 后才开始授权。这个工具默认允许执行，仍经过 hooks 和显式 Permission Rule。成功后，它在当前 Run 的下一 Turn 被真实工具替换。

授权面板和审批、问题共用 FIFO 交互队列。面板自动打开浏览器，显示完整 URL，允许复制链接、重新打开浏览器、取消，或粘贴完整回调 URL。本地回调到达时面板自动关闭；回调监听在 `127.0.0.1`，redirect URI 使用 `http://localhost:<port>/callback`。授权等待最多五分钟；取消或 Run 中止按未完成授权处理。授权开始触发 `Notification` hook，`notification_type` 为 `mcp_auth`。

Headless CLI 不提供授权交互，也不向模型暴露 `authenticate` 工具。它提示在 TUI 登录并继续使用其他 server；stream-json 输出 `mcp_auth_required`，登录提示写入 stderr。预期的授权需求不作为 `mcp_server_error`；实际连接或工具错误仍发布该事件。TUI 获得的 MCP Credential 可被后续 Headless Run 复用。

## MCP Credential

终端 MCP Credential 存在 Session 的 `homeDir` 下的 `.rukie/credentials.json`，文件权限为 0600，新建目录权限为 0700。按 server 名、URL 与展开后的 headers 区分，所有 Session 和子代理共用；同名但 URL 或 headers 不同的 server 不能借用。终端 Provider 凭据继续来自环境变量。桌面指定独立 `dataRoot`，不读取终端配置、凭证或环境 API Key；MCP OAuth 在加密凭证 adapter 未安装时保存失败，不写入临时明文存储。应用来源与真实工具 home 的契约见 [Agent README](../packages/agent/README.md#用户来源与工具-home)。

写入使用临时文件和 rename。损坏 JSON 被视为空并告警，直到下一次成功写入前保留原文件。pi-mcp 负责 token 刷新；授权失效或需要额外 scopes 时重新回到 `needs-auth`。登出删除本地凭据，不向授权服务器撤销 token。

运行连接属于进程级 MCP Host。server、TUI 与 Headless 各创建一个 Host 并注入 Session；未注入时 Session 创建私有 Host。项目视图保留项目覆盖同名用户级和 Trusted Project 规则，同项目的 Session 与子代理租用同一连接，TUI 替换 Session 继续复用。全局单例在 Host 创建后后台预热，同时最多初始化 3 个 stdio 和 8 个远程 server，保留到进程退出。项目实例在首次租用时连接，最后一个租约释放 30 秒后关闭；在期限内重新租用取消关闭。

连接身份由作用域、server 名与展开后配置的稳定签名确定。用户消息和原生 Run 开始前重新读取配置；配置变更新建一代连接，旧连接完成进行中的调用后关闭。Run 中止只取消等待与该 Run 的调用，Host 的连接继续服务其他 Session。需要授权的状态属于连接，避免每次 Run 重复发起未授权请求；同连接并发授权共用发起 Session 的 Interaction，发起方取消会向所有等待者返回取消。子代理的授权经父 Session 转发并带上 origin。登录、登出和重连在该 server 有进行中的调用时返回 busy。

连接初始化或退避重连期间，状态立即返回 `pending`，工具数组和 `toolCount` 均为空／0；Run 开始前等待这些连接落定，中止只取消该 Run 的等待。意外关闭最多重试 5 次，依次等待 1、2、4、8、16 秒（退避延迟上限 30 秒）；每次替换前等待旧一代的原始关闭 Promise，确认 transport 清理完成。只有连续健康连接满 30 秒才重置重试次数，初始化成功或短暂恢复不重置；耗尽后保留 `failed`，可手动重连。主动关闭与 `needs-auth` 不自动重试，断线期间旧工具调用直接失败。

MCP Host 订阅协议通知 `notifications/tools/list_changed`，按 server 和连接代串行读取完整的分页工具列表。整次发现成功才替换工具描述、Schema 与工具集；发现失败保留上一代并告警，已退休连接的晚到结果丢弃。根 Session 与子代理在下一 Turn 边界读取变更，包括工具名称相同但描述或输入 Schema 改变的情况。

`session.close()` 取消本 Session 的授权交互并释放租约，私有 Host 同时关闭；注入 Host 的 Frontend 在进程退出时显式 `close()`。Resume 根据当前配置租用连接，不恢复旧 transport。桌面启动只为全局单例解密用户 MCP 配置及对应 HTTP 凭据；项目凭据在首次连接时解密，Hooks 与供应商凭据继续按使用时机读取。

普通 MCP 工具使用原生 unsafe replay，read-only 或 idempotent 提示不授予自动重放。工具执行后、结果提交前中断时，恢复保留未知结果，不重新调用 server；改变当前工具说明、schema 或提示也不能提升已提交 intent 的重放权限。

## Frontend 接口

Session 暴露 `mcpServers()`、`authenticateMcp(name)`、`clearMcpAuth(name)`、`reconnectMcp(name)`；类型与取消契约以[公共 Session 声明](../packages/agent/src/session/index.ts)和[共享状态类型](../packages/shared/src/mcp.ts)为准。状态中的 `error` 保留原始英文消息；已知 Agent Core 错误另带 `errorData`，Frontend 用它按 locale 呈现。

`mcpServers()` 返回独立副本 `McpSnapshot`，包含 `servers` 与配置文件级 `configErrors`。服务器记录提供生效配置的 `scope`、`configPath`、HTTP `url` 或 stdio `command`，以及真实 MCP 工具的协议名称、完整描述和原始输入 JSON Schema。URL 保留环境变量配置表达式，移除 userinfo、query 和 fragment；快照不包含 headers、env、args、clientSecret 或 MCP Credential。pending/failed/needs-auth/project-required 的工具数组为空，`toolCount` 与真实工具数组一致。损坏文件记录来源、路径和错误；缺失文件不算错误，其他合法来源仍可使用，Run 保持 fail-open 和现有警告行为。

普通快照不等待连接完成，返回项目视图中共享连接的最新状态，包括其他租用者触发的连接、授权或失效和管理操作。查询重新读取完整配置，同配置并发读取合并，已有连接继续复用；状态查询不再创建随后关闭的独立探测连接。调用方修改返回值不会改变 Host、Session 或模型工具声明。`mcpServers({ refresh: true })` 提供空闲时的显式刷新并等待连接落定，并发刷新复用在途请求；它不自动启动 OAuth 或更改 MCP Credential。Run 中显式刷新及三个管理方法返回 busy 错误。Session 关闭取消本视图的等待与管理交互，共享连接保留给其他租约；晚到读取不能覆盖较新的连接配置。

公开事件 `mcp_servers_changed` 表示新快照已提交，不携带工具 schema；Frontend 收到事件后调用普通 `mcpServers()` 读取当前视图。文件级诊断与服务器状态、工具的实际变化都可触发事件；相同快照和缓存读取不重复通知。面板通过这些事件更新，无轮询；连接恢复由 MCP Host 负责。稳定服务器名与协议工具名保留导航身份；当前工具消失时退回仍有效的工具列表，没有工具时退回服务器详情，服务器消失时退回服务器列表，并显示变化提示。

Frontend 提供 `onMcpAuth` 以显示 Interaction；没有回调时主动登录被拒绝，模型也看不到登录工具。管理面板、选择、阅读位置、结果和授权 UI 都属于 Frontend 本地状态，不写 Transcript、Tool State 或 reminder；Session Resume 不恢复面板。Interaction FIFO 临时接管面板输入，队列处理完后恢复有效页面。关闭、Session 替换或退出清理面板订阅，晚到结果不能重新打开面板或更新另一 Session。

原生认证工具挂起时 close/reopen 会按当前信任和精确 endpoint／headers 配置重新发起授权，替换 listener、state 与 verifier；旧 callback 不能完成新授权。code exchange 开始后仍采用 unsafe 中断语义，不能自动重发已使用或结果未知的 code。请求身份与取消契约见 [Agent Core pending interactions](../packages/agent/README.md#pending-interactions)。

`createMcpHost({ configuration, applicationVersion })` 在后台预热用户全局配置，`ready` 可等待预热完成。`acquire` 创建项目视图并绑定调用方的配置读取、事件和 Interaction；Session 负责租约收尾，Frontend 负责 Host 的进程生命周期。MCP transport 创建失败和 Host close 均释放已建立的资源。`SessionOptions.initializationSignal` 只约束打开过程，不取消其他 Session 的共享 transport 或已接受的后台工作。

### 无 Session 的状态视图

`McpHost.inspect({ homeDir, settings, cwd?, persistence? })` 只重读配置并返回已有连接的快照，不取得租约、不启动进程。生效配置尚无匹配连接时显示 `pending`，不代表该只读调用正在启动连接。无项目时只返回用户来源，引用 `${RUKIE_PROJECT_DIR}` 的条目用 `project-required` 表示「选择项目后启动」，工具数为 0；它是配置等待项目的展示状态，不参与连接重试。`observe(input, onChange)` 按相同规则订阅现有 Host 变化，调用方关闭 observer 后不再接收推送。`acquire({ noProject: true, ... })` 可租用无项目视图中的全局连接，仍不启动这些等待项目的条目。以上接口共用 Host 的连接表。

桌面与 Web 通过 `mcp.status` 查询状态，使用 `projectId`、`sessionId` 中至多一个标识；无标识表示无项目。`mcp.subscribe` 另接收调用方生成的 `viewId`，默认取得活动视图租约；`active: false` 只观察现有状态。二者均不打开 Session、不要求模型或供应商凭证，也不读取 Hooks。服务按注册 Project 和持久化 Session 的实际目录、信任解析视图，推送 `{ type: "mcp_status", viewId, snapshot }`。同一 socket 的同名 viewId 替换旧订阅；`mcp.unsubscribe`、socket 关闭及宿主替换释放订阅和租约，晚到读取不会取得租约。客户端重连重新订阅当前视图。

主输入框的 `/mcp` 一级行显示实时汇总，零值分段隐藏，初次加载显示加载状态。进入后按服务名过滤并显示来源、状态、工具数与独立配置错误；所有状态行都是只读的不可用选项，不发送或插入会话。显示已有 Session、选择 Project 或查看 `/mcp` 时租用活动视图；切换范围、退出详情或关闭客户端时释放原订阅，再按当前 Session／Project 范围决定是否取得新活动视图。未选 Project 的新会话普通摘要只观察现有全局状态。Esc 从详情回到上级，再按一次清空并关闭；删除命令前缀也回上级。列表沿用组合框的焦点和键盘语义。
