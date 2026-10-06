# MCP 列表与详情面板访谈

Status: resolved

## 已确认范围

用户要求复刻 Claude Code 输入 `/mcp` 后的服务器列表与详情交互，并采用 Neant TUI 通用 Design System。

- `/mcp` 打开管理面板，按用户与项目配置分组，显示服务器名称、状态图标和数量。
- ↑/↓ 循环选择，Enter 或鼠标点击进入服务器详情；长列表随选择滚动。
- 详情显示状态、传输方式、URL 或启动命令、配置来源、授权方式、工具数与错误信息，提供现有登录、登出、重连操作。
- 详情中 Esc 返回列表并保留选中项；列表中 Esc 关闭面板。
- 验证中英文、40×12、resize、鼠标操作与其他面板共存。

## 事实与归属

Claude Code 的参考流程是 MCPSettings → MCPListPanel → MCPStdioServerMenu / MCPRemoteServerMenu。交互层次作为参考；Neant 的外观与布局采用现有 `@neant/tui` Design System、[TUI renderer 约定](../../packages/tui/README.md)与 [ADR-0006](../../docs/adr/0006-fullscreen-tui.md)。当前仓库没有独立的通用 DESIGN.md。

沿用 [CONTEXT.md](../../CONTEXT.md) 的 Slash Command、Interaction、MCP Server 与 MCP Credential。MCP 管理面板属于 Frontend 的本地界面状态；OAuth 授权继续是 Agent Core 发起的 Interaction。现有术语足以表达本次改动。

Session 的公开 MCP 快照目前包含名称、传输、连接状态、工具数、授权方式和错误，不包含配置来源、URL、启动命令或工具声明。Core 合并配置时由 Trusted Project 的同名配置覆盖用户配置；分组与详情数据需要由 Core 的同一配置读取路径提供，Frontend 消费公开接口。

目前只有 mcp_server_error 与 mcp_auth_required 事件，没有完整连接状态变更事件。mcpServers() 读取已有快照；没有记录时执行一次独立探测。现有 Frontend 在 `/mcp` 和管理操作后刷新。

## 第一轮：已确认

### Q1：Interaction 与管理面板

用户采用推荐：审批、提问或授权 Interaction 临时接管焦点；完成后恢复 MCP 页面、选中项和滚动位置。Run 中仍可浏览，登录、登出、重连显示 busy。

### Q2：管理操作完成后的页面

用户采用推荐：留在服务器详情并刷新状态。登录时进入现有授权面板，成功、取消或失败后返回原详情并显示结果；Esc 返回列表并保留原选中项。

## 第二轮：已确认

### Q3：面板打开期间的数据刷新

用户采用推荐：随 Core 状态变更更新。打开面板及管理操作后也读取最新快照；不定时轮询，不额外建立探测连接，刷新时保留选择和滚动位置。Core 需要提供完整 MCP 状态变更通知。

### Q4：工具浏览层级

用户采用推荐：支持服务器详情 → 工具列表 → 工具详情。工具列表显示名称与简介；详情显示完整描述和输入参数 schema，只读浏览，键盘和鼠标操作一致，Esc 逐层返回。

### Q5：加载、空配置与探测失败

用户采用推荐：保留面板。加载完成自动展示列表；空配置显示配置路径；失败显示错误与重试操作，均可 Esc 关闭。

## 第三轮：已确认

### Q6：面板框架

用户采用推荐：使用 Rewind 的输入区上方分隔线面板框架。复用 Divider、ListItem、StatusIcon、HintLine 与当前主题 token；选中行显示 `❯`，鼠标悬停不改变键盘选择，各层使用相同框架。

### Q7：长详情阅读

用户采用推荐：标题与返回提示固定，正文独立滚动，支持 ↑/↓、PageUp/PageDown 与鼠标滚轮；输入参数 schema 使用格式化 JSON。返回上一页恢复阅读位置，40×12 下保留可操作正文窗口。

### Q8：刷新后的导航

用户采用推荐：保留仍然存在的服务器与工具选择。当前项消失时返回最近的有效上级页并提示变化，不自动打开另一个工具。

### Q9：中断按键

用户采用推荐：Run 中浏览 MCP 管理面板时，Ctrl+C 中断 Run 并关闭面板；空闲时 Ctrl+C 只关闭面板。Esc 逐层返回；Interaction 接管期间沿用现有取消行为。

### 输入框禁用

用户明确补充：展示 MCP 面板时，输入框不能进行输入。服务器列表、服务器详情、工具列表、工具详情以及加载、空配置、失败页面均由面板独占键盘操作；普通字符、粘贴、输入历史与 Slash Command 补全不得修改主输入框草稿。关闭面板后恢复输入框操作，保留原草稿与光标；面板接管后不得执行晚到的主输入框粘贴结果。OAuth 回调 URL 的输入属于现有授权 Interaction，继续由授权面板处理。

## 最终共享理解

2026-10-06：用户在完整设计汇总后回复“确认”。Q1–Q9 与输入框禁用要求均已确认，产品决策树的 frontier 为空。[最终 spec](spec.md) 与编号实施工单据此编写。本记录属于已确认的设计约定，不表示实现已经完成。
