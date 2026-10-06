# MCP 列表与详情面板

Status: claimed

## Problem

Neant 的无参数 `/mcp` 目前把服务器状态写成文本报告，用户不能通过列表选择服务器、查看配置和工具详情或在同一界面管理连接。用户要求复刻 Claude Code 的列表与详情导航，外观采用 Neant TUI 通用 Design System，并明确要求 MCP 面板显示期间主输入框不能输入。

## 已确认设计与参考

[访谈记录](interview.md) 的 Q1–Q9、输入框禁用要求与最终共享理解已由用户确认。Claude Code 本地参考的 MCPSettings、MCPListPanel、MCPStdioServerMenu、MCPRemoteServerMenu、MCPToolListView、MCPToolDetailView 提供导航与信息层次；Neant 的组件、配色、光标、布局和小终端行为以当前 `@neant/tui` Design System、[renderer README](../../packages/tui/README.md)、[架构](../../docs/architecture.md)与 [ADR-0006](../../docs/adr/0006-fullscreen-tui.md)为准。仓库没有独立的通用 DESIGN.md。

本功能建立在已交付的 [MCP OAuth](../mcp-oauth/spec.md) 上，沿用 [MCP 配置与授权](../../docs/mcp.md)的项目信任、凭据归属、授权、连接与取消语义。原 OAuth 工单 08 的真实账号验收仍独立待办，本功能不能把它记为已通过。

## Ownership

- Agent Core 读取、合并和验证 MCP 配置，拥有工具发现、OAuth、连接状态与可展示快照；Frontend 不重复读取配置、判定 Trusted Project 或读取 MCP Credential。
- TUI screen 消费 Session 公开接口，拥有当前页面、焦点、滚动位置、管理操作及主输入框锁定。App component 消费 props；通用视觉组件来自 `@neant/tui`。
- 沿用 [CONTEXT.md](../../CONTEXT.md) 的 Slash Command、MCP Server、MCP Credential 与 Interaction。管理面板是 Frontend 本地界面状态；OAuth 授权仍是 Interaction。
- 面板、选择、报告、详情与状态通知不写 Transcript，不进入模型上下文，不通过 Tool State 持久化；Session Resume 不恢复 MCP 面板。

## Agent Core 展示数据

扩展现有 `McpServerView` 与 `Session.mcpServers()`，让同一份快照提供列表和详情数据。返回值整理为 `McpSnapshot`，包含 `servers: McpServerView[]` 与 `configErrors`；后者记录配置文件级错误的 scope、路径、错误和可选 errorData，区别于单服务器 failed 状态。共享类型仍放在 `@neant/shared`，公开 Agent API 通过现有 package entry point 导出，所有仓库消费者在同一变更中更新，不另设重复读取 API。

- 保留名称、`stdio | http`、`connected | needs-auth | failed`、工具数、`oauth | headers | none` 与 `error/errorData` 的既有语义。
- 补充有效配置来源：`user | project` 与实际配置路径。同名配置仍由 Trusted Project 的项目项覆盖用户项，只展示生效的一项；未受信任的项目配置仍不可见。
- 补充连接展示信息：HTTP URL 或 stdio command。URL 展示定位信息，排除 userinfo、query 值与 fragment；环境变量配置保留配置表达式，不把敏感展开值加入展示数据。不提供 headers、env、clientSecret 或 MCP Credential；本次不增加 args 展示。
- 补充真实 MCP 工具的原始名称、描述与输入 JSON Schema。工具来自已有 listTools 结果，不额外请求；JSON Schema 保持原义，缺少描述时使用空文本。共享 schema 数据用 `unknown` 或经过验证的 JSON 对象表达，不引入运行时或 SDK 依赖。
- 服务器名与其协议工具名组成稳定导航身份。真实工具数组与 `toolCount` 一致；needs-auth/failed 不展示不可调用的旧工具或 Neant 的 authenticate 占位工具。
- 每个状态构造与转换保留来源和展示信息，包括配置错误、首次 probe、Run 连接、同一 Run 授权替换、失效、登出、重连和取消。返回独立副本，调用方修改展示数据不能改变 Session 或工具声明。
- 损坏的整个配置文件进入 `configErrors`，不能伪装成正常空配置；合法来源中的服务器仍可展示和使用。不存在的配置文件不视为错误。保留既有 Run 配置读取的 fail-open 与警告语义，面板诊断不会使其他合法 MCP 或模型请求失败。

`mcpServers()` 延续现有快照契约：已有记录时只读记录；没有记录时合并并复用一次独立探测，完成后关闭资源。保留 revision guard，晚到 probe 不能覆盖更新的 Run 结果。浏览工具与详情不会建立连接或调用模型。

用户点击配置/读取失败的“重试”时调用 `mcpServers({ refresh: true })`，由 Core 重新读取配置并执行一次完整探测，更新服务器与文件级诊断；缺省调用不强制刷新。显式刷新属于管理操作，仅空闲可用，Run 中使用既有 busy；并发刷新复用在途请求，使用同一取消、dispose、revision guard 与资源清理路径，不自动启动 OAuth 或更改 Credential。单服务器失败的详情重试仍使用 `reconnectMcp(name)`。

## 状态通知

新增轻量公开事件 `mcp_servers_changed`，仅表示 Session 的 MCP 展示快照已变化，不携带完整工具 schema。先提交新快照，再发布事件；Frontend 收到事件后调用 `mcpServers()` 读取已记录数据，不建立新的探测连接。

首次探测、显式刷新、Run 连接结果、同一 Run 授权成功或再次需要授权、管理操作成功/失败/取消造成的实际变化均通过同一个快照提交路径通知。无变化时不反复通知，读取已有快照不触发通知，避免事件与读取循环；首次读取引发的探测提交可以发出变更事件。文件级诊断的变化也属于快照变化。保留现有 `mcp_server_error`、`mcp_auth_required` 与一次性授权提示。

单服务器管理结果只替换对应服务器记录，不能清掉其他服务器；首次公开读取之前直接管理某个服务器，也不能让后续全量报告只剩该服务器。只有完整、可读的新快照提交后才发布变更通知，保留首次读取和管理并发的既有等待与资源清理语义。

Frontend 在打开面板、管理操作完成及状态事件到来时刷新；共享在途读取，旧 Session 或已关闭页面的晚到结果不能重新打开面板、改变焦点或更新新 Session。状态更新由 Core 通知驱动，不使用定时轮询或后台重连。

## 面板框架

面板位于输入区上方，采用 Rewind 的 flow 布局、permission Divider、remember 标题、suggestion 选中行与 inactive 描述，复用 Divider、ListItem、StatusIcon 能表达的状态、HintLine、ScrollBox 和当前 theme token。needs-auth 使用已有 warning 语义表达。各层使用相同框架，不新增主题或专用渲染管线。

面板在可用空间内按内容确定高度，最多 14 行；标题和底部操作提示固定，正文获得剩余预算。长列表使用围绕焦点的有界窗口，边界显示滚动提示，焦点变化不造成布局抖动。40×12 时保留可操作内容与其他持久面板的至少一行预览；activity、返回底部提示等按现有预算先让出空间。小于 40 列或 12 行沿用暂停交互提示，保留面板状态以及中断/退出能力，resize 恢复选择和有效阅读位置。

## 页面与导航

### 服务器列表

无参数 `/mcp` 打开面板，替代旧文本 report；接受该命令仍沿用原输入清理与输入历史规则，不产生模型请求。标题显示管理 MCP 服务器和总数，按 project、user 顺序分组，各组按名称排序，显示配置路径。分组标题不可选；服务器行显示名称、状态图标、状态文字与工具数。

↑/↓ 在可选项之间循环，Enter 或鼠标单击直接进入详情，鼠标 hover 仅显示通用背景，不改变键盘选择。滚轮移动列表选择，选中项保持可见。Esc 关闭列表；重新打开读取最新状态。加载期间保留面板，结果到达后自动展示列表。没有服务器且没有文件级诊断时为空配置，显示用户与项目配置路径及项目信任条件；读取失败或文件级诊断显示错误与可用的重试操作，不退出面板。有部分合法服务器时同时保留列表与诊断/重试入口。服务器连接失败仍是正常可选行，可在详情查看错误与重连。

### 服务器详情

展示服务器名、状态、传输、有效配置来源与路径、HTTP URL 或 stdio command、授权方式、工具数及可用错误。已知 Core 错误通过现有 `formatError` 本地化；外部错误保留信息。正文可滚动，操作行使用通用可选列表；Tab 在正文阅读和操作列表之间切换焦点，并在提示中说明。↑/↓ 在正文焦点滚动，在操作焦点移动选择；PageUp/PageDown 与正文区域滚轮用于阅读，鼠标点击动作直接执行。

提供查看工具（存在真实工具时）、登录（HTTP OAuth 需要授权时）、登出（HTTP OAuth 时）、重连与返回。操作复用 `authenticateMcp`、`clearMcpAuth`、`reconnectMcp`，不新增协议；Run 中管理操作显示既有 busy，仍可浏览。已有 `/mcp login|logout|reconnect <server>` 与两层补全继续工作，直接子命令保持原通知语义。

管理操作结束后留在原详情并刷新状态，成功、失败、取消都有结果反馈。OAuth 请求继续进入已有 Interaction FIFO；面板临时让出，授权完成或取消后恢复原详情。进行中的管理动作禁止重复提交。Esc 或返回动作回到服务器列表，保留服务器选择与阅读位置。

### 工具列表与工具详情

工具列表按协议工具名排序，显示名称与单行简介，复用列表键盘、鼠标和窗口规则；选择后进入详情。工具详情固定名称、返回提示，正文显示完整描述和格式化 JSON 输入参数 schema，支持 ↑/↓、PageUp/PageDown 与鼠标滚轮阅读。工具浏览只读，不调用工具。Esc 或鼠标返回逐层回退并恢复各页焦点与阅读位置。

刷新按稳定身份保留当前服务器与工具。当前工具消失时返回其仍存在的服务器工具列表；服务器消失时返回服务器列表；没有剩余工具时返回服务器详情。显示变化提示，不自动打开另一项。源数据更新或 resize 后，只把滚动位置限制到有效范围，不强制跳回顶部。

## 输入、Interaction 与生命周期

- MCP 面板显示的所有页面，包括 loading、空配置、读取失败，均禁用主输入框编辑和提交。普通字符、粘贴、输入历史、图片粘贴和 Slash Command 补全不能修改主草稿、光标或附件；主输入框不显示编辑光标，键盘由当前面板处理。
- 打开面板时使在途主输入粘贴/图片处理失效；晚到结果即使面板已经关闭也不能写回。关闭后恢复主输入框及此前草稿、光标、附件；接受 `/mcp` 命令本身的正常输入清理不回填为草稿。
- Interaction 到来时临时接管渲染与键盘/鼠标焦点，MCP 面板保留页面状态并暂停消费输入；FIFO 队列处理完后恢复。主输入框仍不可编辑，OAuth 自己的回调 URL 输入继续可用。
- 列表与详情的 Esc 逐层回退。Ctrl+C 在 Run 中中断 Run 并关闭管理面板，空闲时只关闭面板；Interaction 接管时保留其现有取消规则。退出仍恢复终端，不能遗留订阅、计时器或回调 server。
- 遇到其他本地 picker 已打开时不叠加两个可操作的本地面板；既有入口继续按焦点规则拒绝。Todo、Subagent、Goal 等持久面板按既有预算共存，不改变折叠状态或 Transcript 阅读锚点。
- Session 替换/Resume、screen 卸载和应用退出清理 MCP 面板与订阅；晚到读取、host 或管理操作结果不能更新另一 Session。

## Testing Decisions

- Core 使用 `createSession`、fake model 与现有 MCP/OAuth fixture：用户/项目同名覆盖与不信任隔离、URL 展示信息与凭据隔离、原始工具描述/schema、三个连接状态、独立副本、首次探测资源清理、首次读取前管理仍保留全部服务器、损坏配置诊断/部分合法来源/修正后显式刷新、同一 Run 授权/失效、登出/重连、取消与旧 probe 竞态。
- 状态事件通过公开订阅测试：通知后的读取一定是新快照，无读-事件循环、无额外 listTools/连接；Run 中连接和授权变化可见，重复快照不产生重复更新，Headless 的既有警告与输出仍正确。
- TUI 使用 `start` 与注入/headless terminal：四层导航、稳定选择、鼠标单击/hover/滚轮、键盘翻页、长 schema、zh/en、40×12、resize、小于下限暂停恢复，包含具体终端行与颜色断言。
- 验证主输入锁：字符、Enter、方向键、Tab、文本/图片粘贴、历史及补全不影响主输入；面板开启前挂起的 clipboard/图片读取在关闭后返回仍不能改草稿；OAuth 自定义回调输入不受误伤。
- 跨概念场景：Run 中 `/mcp` 不调用模型，管理 busy；审批/问题/OAuth FIFO 临时接管后恢复；操作结果返回详情；Core 在微任务边界更新状态时页面不丢选择；工具消失退回有效上级；与 Todo/Subagent/Goal 共存且阅读锚点稳定。
- 面板关闭/Resume 不添加或恢复 Agent Core Transcript 内容；重复开关、换 Session、取消和退出没有晚到更新或残留资源。沿用事件、完成信号与终端谓词同步，不使用猜测性 sleep。
- 开发运行 focused 测试，交付在临时 HOME、unset NO_COLOR 下运行 `bun run check`；格式、lint、types、Knip 与全量测试均需当前通过证据。记录真实命令与结果，不以模拟测试关闭原 OAuth 的真实账号待办。

## Task Graph

| Ticket                                      | 内容                                           | Blocked by |
| ------------------------------------------- | ---------------------------------------------- | ---------- |
| [01](issues/01-core-display-snapshot.md)    | Core 配置来源、连接展示信息与工具快照          | —          |
| [02](issues/02-core-state-events.md)        | Core 快照提交与状态变更事件                    | 01         |
| [03](issues/03-tui-panel-components.md)     | 四层通用面板组件与阅读布局                     | 01         |
| [04](issues/04-tui-controller-and-input.md) | TUI 导航、事件接线、管理、Interaction 与输入锁 | 02, 03     |
| [05](issues/05-end-to-end-and-docs.md)      | 跨概念验收、消费者文档与完整检查               | 04         |

01 的共同基线验证并集成后，02 与 03 可独立开发；04 在两者集成后开始，05 最后验证完整行为。实施遵循仓库的公开测试、两轴审查、状态证据与集成要求。

## Out of Scope

- enable/disable、添加/删除/编辑服务器配置、后台自动重连、定时刷新。
- MCP prompts/resources 浏览、Claude.ai/enterprise/agent-only 配置层以及新的传输协议。
- 改变 OAuth、凭据、权限、项目信任或子代理配置语义；新增工具执行入口。
- 持久化管理面板或把展示数据加入模型上下文；重设计其他 TUI 页面。

## Comments

- 2026-10-06：用户逐轮接受 Q1–Q9 推荐，补充主输入框禁用要求，并确认最终共享理解。访谈转为 resolved；本 spec 与五张票为 ready-for-agent，尚未实施。
- 现有术语与包职责足以表达本功能，未新增 glossary 概念或改变现有 ADR；可逆界面约定留在本 spec。实施分支起点为已交付的 `main` `c53bd5c`。
- 只读事实复核补齐技术契约：配置文件损坏不能混为空配置，用户重试需要 Core 显式刷新；首次管理不能丢其他服务器，首次 probe 提交通知与缓存读取不通知分别明确。未开始产品代码实施。
- 2026-10-06：用户调用 implement-spec，开始在 `codex/mcp-panel` 集成实施；固定审查起点 `97b570739d28b5e0ba637aac7fa46ca609cbb16f`。01 先行，验证并集成后 02 与 03 并行，04、05 依次推进，每票使用独立受管理 worktree。
- 起点代码与已验证的 `main` `c53bd5c` 完全一致（apps、packages、锁文件与脚本无差异）；该代码的隔离 HOME 完整检查为2309 pass、0 fail，11818 assertions，166 files，315.56s，format/lint/types/Knip全部通过，日志 `/tmp/neant-mcp-oauth-main-check.log`。本次变更仍需新的 focused、集成完整检查与两轴审查。
