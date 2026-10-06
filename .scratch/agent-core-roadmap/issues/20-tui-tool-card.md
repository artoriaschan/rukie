# 20: TUI 工具卡复刻 dsh-TUI

Type: grilling
Status: resolved
Blocked by:

## Question

把 Neant TUI 的通用工具卡（目前是 `ToolCall`：状态图标、一行摘要、`⎿` 下一行截断结果）整体升级为 dsh-TUI `src/components/messages/AssistantToolUseMessage.tsx` + `ToolUseLoader.tsx` 的样式与交互，覆盖所有工具。

charting 中已知的 dsh 行为：

- 状态点：运行中闪烁 `●`；完成后为按类别着色的 `•`（exec / read / write / web / task，主题色）；出错为红色 `✗`。
- 头部：加粗的工具名（可本地化）+ 标题或参数；右侧耗时 chip。
- 正文：挂在 `⎿` 下，折叠为 3 行（diff 为 8 行），后接 `+N lines (ctrl+o to expand)`；点击或 `ctrl+o` 展开。
- 交互：悬停整行变色并出现 `▾`；标题被截断时有 tooltip。
- 按 card 类型分别渲染：diff / terminal / read / search / generic。

需定：

- 复刻范围（split diff、smooth reveal、点击打开文件是否纳入）。
- Agent Core 侧需不需要一个 presentation 层（类似 DSH 的 `presentCall` / `presentResult`），还是由 TUI 从工具名和参数推导。
- 与现有特例卡片（todo、goal、plan review、子代理、ask user）怎么共存。
- Neant 现有 `ctrl+o`、点击等按键是否冲突。

来源：[web fetch](15-web-fetch.md) Q10/Q11。

## Answer

### Tool View 契约归 Agent Core

工具可选声明 `presentCall(args)` 与 `presentResult(args, result, details)`：纯函数，参数非法或失败返回 `undefined`，frontend 退回 generic。类型以 TypeBox 写在 `@neant/shared`，结构照 harness `packages/core/tools/src/presentation.ts`：call view 为 `Generic | Terminal | Diff`，result view 为 `Generic | Terminal | Diff | Search | Read | Web`。消费方不止 TUI，后续有 Web 端，故契约不能留在 TUI。

View 不持久化：`tool_execution_start` / `tool_execution_end` 事件携带 view，resume 时由 Session 按 Transcript 重算（`messages` 投影附带 view）。Transcript 仍是唯一事实来源，presenter 改进后旧 Session 同样受益；工具已不存在（如 MCP 未连接）时退回 generic。`subagent_event` 转发的事件天然带 view，子代理详情页无需额外处理。

### locale：view 只放事实

ADR-0008 不变，Agent Core 不感知 locale。View 不含自然语言文案，只带 `displayKey`（如 `tool.bash`）与事实字段（命令、路径、URL）。TUI zh/en 字典补齐所有内置工具名，查不到时原 id 首字母大写。MCP 工具显示为 `srv › tool`。

### 类别只保留一套

删掉 dsh 的三套并行映射（点色按 id、名色按 `category`、`kind` 未用），统一用 view 上的 `kind`：`read | edit | delete | move | search | execute | fetch | task | other`。点色与工具名色都由它派生：exec←execute；read←read/search；write←edit/delete/move；web←fetch；task←子代理/todo/goal。删除现有 `toolNameColor` 的工具名启发式，主题新增 `toolDot*` 五个 token。MCP 工具一律 `other`。

### 复刻范围：全部

1. 闪烁 `●`（600 ms，失焦转常亮）、类别色 `•`、红 `✗`
2. 头部加粗工具名 + args/title，右侧耗时 chip（仅结束后显示，hover 时提亮）
3. `⎿` 正文折叠 3 行、diff 8 行；只剩一行时不折叠；展开上限 400 行；退出码/信号、full-output 缺失声明、脚注指针永不折叠
4. hover 行变色 + `▾`（展开为 `▴`）；点击切换单卡
5. 标题截断时 tooltip（600 ms，含起止时刻与退出码，不含耗时）
6. unified diff：`-`/`+` 前缀、多文件路径行分隔、hunk 间 `⋯`
7. split diff：`diffLayout` 为 `split`，或 `auto` 且 ≥110 列；词级高亮、截断不换行
8. 语法高亮：args 按 JSON、正文按扩展名
9. smooth reveal：仅 pending call view 逐行揭示，~30 fps，`max(3, ceil(backlog/8))`；result view、错误、已展开、replay 不启用
10. 点击路径 → FileActionsPanel（打开 / 在文件管理器中显示 / 复制路径），复用 `host.openExternal`，不开编辑器
11. transcript 模式 `/` 搜索 + `n`/`N` 跳转

高亮依赖（dsh 用 `cli-highlight` + `highlight.js`）实现期再定选型；`diff` 8.0.4 已装。

### ctrl+o 为全局展开

`ctrl+o` 改为全局 `expanded`（transcript 模式），展开所有卡片与 thinking；删除 `jobsExpanded`，job 组折叠并入同一状态。点击单卡另有 `expandedRows`，最终 `verbose = expanded || expandedRows.has(id)`。折叠提示 `… +N lines (ctrl+o to expand)`。transcript 模式下 `/` 与 `n`/`N` 由搜索接管按键，Esc 或 `ctrl+o` 退出后输入框恢复；run 中也可进入。不做按键重绑（Neant 无 keymap 系统，需要时再加）。

### 建卡前分流（照 dsh），推翻部分已定工单

- `todo_write`：不出工具行，交 `GoalTodoPanel`；失败仍出错误卡。**推翻**〔todo 工具〕的「工具卡 `todos ✓ done/total`」。
- `ask_user_question`：不出调用行，由结果投影出「已回答记录」行。
- `enter_plan_mode` / `exit_plan_mode`：不出调用行，交 plan review 行与面板；现嵌在 `ToolCall` 内的 `▸/▾` Markdown 提为独立行。
- `subagent` 系列：不出工具行，只保留 `SubagentMessage` 行。
- goal 工具：结果改写为 generic 摘要卡，〔Goal〕工单的工具卡保留。
- 前台 bash → terminal 卡；后台 job 为独立 job 行（JobCard），bash 调用本身仍 generic。
- `web_fetch` → Web result view，标题为 URL、正文为 markdown（dsh 未渲染此 view，Neant 补上）。

### Agent Core 需补的事实

- bash 结果 `details` 增 `exitCode` 与 `signal`。
- `write` 为出 diff 需旧内容：覆盖已有文件时写前读一次存入 `details`，`oldText: null` 表示新建；超过 diff 截断上限时只存 `patch` 不存全文。
- 耗时与 tooltip 起止时刻取 assistant 消息时间戳与 toolResult 时间戳之差，可重算，不新增字段。

### 设置

用户设置新增 `diffLayout: auto | unified | split`（默认 `auto`）与 `foldTerminalCommand`（默认 `true`）。

### Headless

text 模式不变，只输出最终回复；stream-json 事件自带 view，不额外处理。

### 术语

`CONTEXT.md` 新增 **Tool View**：工具调用或结果的呈现意图，由工具声明、frontend 渲染，不持久化，可从 Transcript 重算。

## Comments

2026-10-06：已出 [Tool View 与工具卡 spec](../../tool-view/spec.md)（ready-for-agent）。
