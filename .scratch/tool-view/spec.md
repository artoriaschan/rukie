Status: ready-for-agent

# Spec: Tool View 与工具卡

来源：[TUI 工具卡复刻 dsh-TUI](../agent-core-roadmap/issues/20-tui-tool-card.md)。术语见 `CONTEXT.md` 的 Tool View、Transcript、Tool State、Session、Run、Subagent、Interaction。参考：deepseek-harness `packages/core/tools/src/presentation.ts`（view 类型）与 `defineTool` 的 presenter 包装；dsh-TUI `AssistantToolUseMessage.tsx`、`ToolUseLoader.tsx`、`SplitDiffView.tsx`、`smoothReveal.ts`、`Tooltip.tsx`、`FileActionsPanel`、`channel/projection.ts`（建卡前分流）、`backends/claude/tools.ts`（MCP 标题）。

## Problem Statement

Neant TUI 的工具卡只有一行 `name + JSON.stringify(args)` 摘要和 `⎿` 下不限行数的原始结果：成功输出可以刷满屏幕，edit 看不到 diff，bash 看不出退出码，长标题没法看全，也没有耗时。每个工具的长相都是 TUI 按工具名零散拼出来的，Headless stream-json 和将来的 Web 端拿不到任何结构化呈现信息。todo、ask user、plan、子代理既出一张通用卡，又有自己的面板或行，transcript 里同一件事出现两遍。

## Solution

工具自己声明 Tool View：调用时和结果时各给一份呈现意图（terminal / diff / read / search / web / generic + 事实数据 + 显示名字典键 + 类别）。Agent Core 把 view 随工具事件下发，resume 时从 Transcript 重算，任何 frontend 都能按同一契约渲染。TUI 以 dsh-TUI 为蓝本整体重做工具卡：类别色状态点、加粗工具名与耗时 chip、`⎿` 正文按 3 / 8 行折叠、`ctrl+o` 全局展开与点击单卡展开、hover 高亮与 tooltip、unified / split diff、语法高亮、smooth reveal、点击路径的文件操作菜单、transcript 搜索。todo、ask user、plan、子代理在建卡前分流，不再出通用卡。

## User Stories

### Tool View 契约

1. As a frontend developer, I want every tool event to carry a Tool View, so that I can render a tool call without knowing each tool's argument shape.
2. As a frontend developer, I want call views and result views to be distinct, so that a running card shows the command or pending diff while a finished card shows output.
3. As a Web frontend developer, I want the Tool View contract defined in a runtime-agnostic shared package, so that the Web client can validate and render the same views as the TUI.
4. As a frontend developer, I want views to contain only facts and a display-name key, so that I localize tool names and copy in my own dictionaries.
5. As a frontend developer, I want a single `kind` on each view, so that color and grouping derive from one classification instead of per-tool heuristics.
6. As a frontend developer, I want a missing or failed view to fall back to a generic view of the raw arguments and result text, so that unknown tools still render.
7. As a tool author, I want to declare optional `presentCall` and `presentResult` functions alongside the tool, so that the tool's presentation lives with the tool.
8. As a tool author, I want a presenter that throws or receives invalid arguments to yield no view instead of failing the tool call, so that presentation bugs never break execution.
9. As a user resuming a Session, I want tool cards to look the same as they did live, so that resume does not degrade the transcript.
10. As a user resuming an old Session, I want improved presenters to apply to old tool calls, so that I benefit from presentation fixes without migrating data.
11. As a user resuming a Session whose MCP server is not connected, I want those tool calls to render as generic cards, so that resume never fails on missing tools.
12. As a Headless CLI user consuming stream-json, I want tool events to carry views, so that my scripts can render or classify tool calls.
13. As a Headless CLI text-mode user, I want output unchanged, so that existing pipelines keep working.
14. As a frontend developer, I want subagent tool events forwarded through `subagent_event` to carry views, so that the subagent detail page renders cards the same way.

### 内置工具的 view

15. As a user, I want foreground bash calls shown as terminal cards titled with the command, so that I see what ran.
16. As a user, I want bash results to show the exit code or kill signal, so that I can tell failure from success at a glance.
17. As a user, I want the exit code and signal never hidden by folding, so that a failure is visible even when output is collapsed.
18. As a user, I want background bash calls to stay generic cards with a separate job row, so that the job card owns live output.
19. As a user, I want edit results shown as diffs, so that I can review what changed.
20. As a user, I want write results shown as diffs against the previous file contents, so that overwrites are reviewable.
21. As a user, I want writes that create a new file shown as all-added diffs, so that creation is distinguishable from overwrite.
22. As a user, I want very large overwrites to still produce a diff from the stored patch, so that the transcript does not bloat with whole files.
23. As a user, I want read results shown as read cards titled with the path, so that I know which file the model looked at.
24. As a user, I want grep and glob results shown as search cards (matches grouped by file, or path lists, with a total when truncated), so that search output is scannable.
25. As a user, I want web_fetch results shown as web cards titled with the URL and a markdown body, so that fetched pages are readable.
26. As a user, I want MCP tool calls titled `server › tool`, so that I can tell which server ran them.
27. As a user, I want goal tool results shown as a short summary card, so that the goal transcript stays compact.

### 卡片外观

28. As a user, I want a running tool to show a blinking dot, so that I know work is in progress.
29. As a user, I want the dot to stop blinking when the terminal loses focus, so that background terminals don't animate needlessly.
30. As a user, I want all running dots to blink in sync, so that the screen doesn't flicker unevenly.
31. As a user, I want a finished tool's dot colored by category (exec, read, write, web, task), so that I can scan what kind of work happened.
32. As a user, I want a failed tool marked with a red `✗`, so that errors stand out.
33. As a user, I want the tool's localized display name in bold followed by its title or arguments, so that I can read what was called.
34. As a user, I want tool names shown in my locale (zh or en), so that the UI is consistent with the rest of Neant.
35. As a user, I want a duration chip after a tool finishes, so that I see slow tools.
36. As a user, I want the duration recomputed on resume, so that it survives restarts.
37. As a user, I want long arguments clipped at a fixed length, so that one call cannot fill the screen.
38. As a user, I want multi-line bash commands folded to the first line plus a `+N lines` hint when `foldTerminalCommand` is on, so that scripts don't dominate the card.
39. As a user, I want tool arguments shown as syntax-highlighted JSON, so that they are readable.
40. As a user, I want file contents in cards syntax-highlighted by extension, so that code reads naturally.
41. As a user, I want a running card with no body to show `Running… (Ns)`, so that I know how long it has been running.

### 折叠与展开

42. As a user, I want text bodies folded to 3 lines and diffs to 8, so that the transcript stays scannable.
43. As a user, I want a `… +N lines (ctrl+o to expand)` hint on folded cards, so that I know more is hidden and how to see it.
44. As a user, I want a fold that would hide exactly one line to show it instead, so that I don't see a pointless hint.
45. As a user, I want `ctrl+o` to expand every card and thinking row at once (transcript mode), so that I can read the whole run.
46. As a user, I want `ctrl+o` to also expand background job groups, so that one key controls all folding.
47. As a user, I want clicking a card to toggle just that card, so that I can inspect one result without expanding everything.
48. As a user, I want an expanded body capped at a 400-line window with a note of how much is shown, so that huge outputs stay renderable.
49. As a user, I want a disclosure line when the full output is unavailable, so that I know truncation happened upstream.

### hover、tooltip 与点击

50. As a user, I want hovering a clickable card to highlight the row and show `▾` (or `▴` when expanded), so that I know it is clickable.
51. As a user, I want the duration chip and fold hint to brighten on hover, so that secondary info is readable when I focus on a card.
52. As a user, I want a tooltip after a short hover delay when the title is truncated, showing the full title plus start/finish time and exit code, so that I can see what was clipped.
53. As a user, I want clicking a path in a card header or diff to open a file actions menu (open, reveal in file manager, copy path), so that I can act on the file.
54. As a user, I want clicking a path not to toggle the card, so that the two click targets don't conflict.
55. As a user, I want clicks on blank cells to be ignored, so that stray clicks don't fold cards.

### diff 布局

56. As a user, I want unified diffs with `-`/`+` prefixes, a path row per file, and `⋯` between hunks, so that multi-file and multi-hunk changes are clear.
57. As a user, I want split diffs with aligned panes and word-level highlights when the terminal is at least 110 columns wide in `auto` layout, so that wide terminals show changes side by side.
58. As a user, I want to force `unified` or `split` with a `diffLayout` setting, so that I control the layout.
59. As a user, I want split diff lines truncated rather than wrapped, so that panes stay aligned.
60. As a user, I want the diff layout to switch when I resize across the threshold, so that it adapts to the terminal.

### smooth reveal

61. As a user, I want pending call views (such as a pending diff) revealed line by line, so that new content appears smoothly.
62. As a user, I want results, errors, expanded cards and replayed cards to appear immediately, so that the reveal never delays information I already have.

### transcript 搜索

63. As a user in transcript mode, I want `/` to start a transcript search, so that I can find text in a long run.
64. As a user, I want `n` / `N` to step through matches, so that I can navigate results.
65. As a user, I want Esc or `ctrl+o` to leave transcript mode and give keys back to the input, so that `/` slash commands still work normally.
66. As a user, I want to enter transcript mode during a run, so that I can inspect progress without waiting.

### 分流（不出通用卡）

67. As a user, I want todo_write to update only the todo panel, so that the transcript isn't cluttered with todo cards.
68. As a user, I want a failed todo_write to still show an error card, so that failures are visible.
69. As a user, I want ask_user_question to show only an answered-record row, so that the question appears once.
70. As a user, I want plan mode tools to show only the plan review row and panel, so that the plan isn't duplicated inside a tool card.
71. As a user, I want subagent tools to show only the subagent message row, so that subagent activity appears once.

### 小终端与恢复

72. As a user on a small terminal, I want cards, tooltips and the file actions menu to fit or clip without corrupting layout, so that Neant stays usable.
73. As a user, I want reading position and bottom-follow preserved when cards expand or collapse, so that toggling doesn't jump the view.

## Implementation Decisions

### Tool View 契约（`@neant/shared`）

- 新增 Tool View 的 TypeBox schema 与类型，结构照 harness `presentation.ts`，去掉自然语言字段：
  - 公共字段：`kind: read | edit | delete | move | search | execute | fetch | task | other`；`displayKey?`（工具显示名字典键，如 `tool.bash`）。
  - Call view：`generic { title?, rawInput? }`、`terminal { command }`、`diff { diffs }`。
  - Result view：`generic { text }`、`terminal { output, exitCode?, signal?, outputUnavailable? }`、`diff { diffs }`、`search { shape: paths | matches, … , total? }`、`read { path, offset?, totalLines?, content }`、`web { url, markdown }`。
  - `diffs` 项为 `{ path, oldText: string | null, newText }` 或仅 `{ path, patch }`（大文件退化形）。
- 只放事实（命令、路径、URL、diff、退出码），不含任何自然语言文案（ADR-0008）。`@neant/shared` 仍只依赖 `typebox`。

### Presenter（`@neant/agent` tools）

- 工具定义增加可选 `presentCall(args)` 与 `presentResult(args, result, details)`，均为纯函数。包装层捕获异常、参数不合法时返回 `undefined`；frontend 遇 `undefined` 退回 generic（标题为 `Name(args)`，正文为原始结果文本）。
- 内置工具各自声明 presenter：bash（前台 terminal，后台 generic）、read、edit、write、grep、glob、web_fetch、goal 工具（generic 摘要）、job 工具；todo / question / plan / subagent 工具声明 `kind: task` 即可，TUI 分流。
- MCP 工具由 mcp 模块统一给 generic view，`kind: other`，`title` 为 `server › tool` 的事实拆分（`server`、`tool` 两字段，由 frontend 拼接分隔符）。

### 事件与 resume（`@neant/agent` session）

- pi 的 `tool_execution_start` / `tool_execution_end` 原样透传给 `onEvent`；Session 在订阅层给这两个事件附加 `view` 字段（call view / result view）。`SessionEvent` 类型相应扩展。
- View 不写入 Transcript。resume 时 Session 对 `messages` 投影中的每个 toolCall 与 toolResult 重跑 presenter，附带 view；工具已不存在（MCP 未连接、工具改名）时为 `undefined`。
- `subagent_event` 包装的子 session 事件天然带 view，不另做处理。
- Headless stream-json 照常输出事件（含 view）；text 模式不变。

### Agent Core 需补的事实

- bash：结果 `details` 增 `exitCode` 与 `signal`（被杀时）。
- write：覆盖已有文件时在写前读旧内容放入 `details`；新建文件记 `oldText: null`；旧内容或新内容超过 diff 截断上限时只存统一 `patch`，不存全文。
- 耗时与 tooltip 起止时刻由 assistant 消息与 toolResult 消息的时间戳计算，不新增持久字段。

### 设置

- 用户设置新增 `diffLayout: auto | unified | split`（默认 `auto`）与 `foldTerminalCommand: boolean`（默认 `true`），按现有 settings schema 加载与校验。

### 类别与主题（`@neant/tui` design system）

- 类别由 `kind` 派生：exec←execute；read←read / search；write←edit / delete / move；web←fetch；task←task；other 用默认色。状态点与工具名颜色共用此映射。
- 主题新增 `toolDotExec / toolDotRead / toolDotWrite / toolDotWeb / toolDotTask` 与 `toolCardBackground`（hover）；删除基于工具名的 `toolNameColor` 启发式及其调用方改为按 `kind`。

### 渲染组件

- 设计系统新增：Tooltip（悬停 600 ms 显示、按可用空间定位、小终端裁剪）、SplitDiffView、语法高亮文本。
- 语法高亮依赖实现期选型（dsh 用 `cli-highlight` + `highlight.js`），版本精确锁定并更新 `docs/tech-stack.md`；`diff` 8.0.4 已装，用于 split diff 对齐与词级高亮。
- smooth reveal：模块级共享调度，约 30 fps，每 tick 推进 `max(3, ceil(backlog / 8))` 行；只作用于 pending call view；result、错误、已展开、replay 卡片不启用。

### TUI 工具卡（`@neant/neant-tui`）

- `ToolCall` 重写为按 view `card` 分支渲染：
  - 状态点：运行中 `●`（macOS `⏺`）600 ms 闪烁，相位取共享时钟，失焦常亮；完成后类别色 `•`；错误红 `✗`；`outcomeUnknown` 仍为黄 `?`。
  - 头部：加粗本地化工具名 + 标题（terminal 为 `Name(command)`，generic 为 `Name(args)` 高亮 JSON 且 480 字符裁剪）；结束后右侧 ` · 耗时` chip。
  - 正文：首行 `⎿`、后续三空格缩进；每行带语气（add / del / dim / plain / error / hint / path）。
  - 折叠：文本 3 行、diff 8 行；只多一行不折叠；提示 `… +N lines (ctrl+o to expand)`，同时有字符裁剪时用合并提示；展开窗口 400 行并注明显示范围；退出码 / 信号、输出缺失声明、脚注不受折叠影响。
- 展开状态：chat 屏幕持有全局 `expanded`（transcript 模式）与 `expandedRows`；`verbose = expanded || expandedRows.has(id)`。删除 `jobsExpanded`，job 组折叠改读同一 `expanded`。
- 按键：`ctrl+o` 切 transcript 模式（有交互、侧问、预览打开时忽略，沿用现有守卫）；transcript 模式下 `/` 进入搜索、`n` / `N` 跳转、Esc 或 `ctrl+o` 退出并把按键交回输入框；run 中可进入。不做按键重绑。
- 鼠标：可点击卡片 hover 时整行 `toolCardBackground` + 固定列 `▾ / ▴`，chip 与提示提亮；点击切 `expandedRows`；点击路径段停止冒泡，打开 FileActionsPanel；空白单元格点击忽略。
- FileActionsPanel：路径按 Session cwd 解析，三项动作——打开（`host.openExternal`）、在文件管理器中显示（host 新增 reveal 能力：macOS `open -R`，Linux 打开父目录）、复制路径（OSC 52，沿用现有复制路径则复用）。
- Tooltip：仅当头部确有隐藏内容（折叠脚本、args 超 480、单行标题超宽）时出现，内容为完整标题 + 起止时刻 + 退出码 / 信号。
- web result 由 TUI 新渲染：标题 URL，正文为 markdown 文本（复用现有 Markdown 组件，仍受折叠规则约束）。

### 建卡前分流

- 在构造 transcript 条目时按工具名分流（替代当前 `toolEntry` 中的零散特例）：
  - `todo_write`：成功不产生条目，只更新 todo 面板；失败产生错误卡。
  - `ask_user_question`：不产生调用条目，结果投影为已回答记录行（现有 `q → answer` 文案）。
  - `enter_plan_mode` / `exit_plan_mode`：不产生工具条目；plan review 结果成为独立行（原 `ToolCall` 内的 `▸ / ▾` Markdown 移出，折叠改走统一展开机制）。
  - `subagent` / `subagent_fork` / `send_message` / `list_agents`：不产生工具条目，只保留 `SubagentMessage` 行。
  - goal 工具：保留，generic 摘要卡。
  - 后台 bash：generic 卡 + JobCard 行，现有 JobGroupHeader 保留。
- 子代理详情页 tools 页复用同一 `ToolCall`。

### 本地化

- zh / en 字典补齐全部内置工具显示名（`tool.<id>` 键），以及折叠提示、`Running… (Ns)`、FileActionsPanel 三项、transcript 搜索提示与无匹配文案。查不到 `displayKey` 时原 id 首字母大写。

## Testing Decisions

- 只测外部行为：Agent Core 经事件与 `messages` 投影观察 view，TUI 经 headless terminal 的屏幕内容与输入序列观察卡片。不测 presenter 函数、调度器、颜色映射等内部实现。
- 两个接缝，均为现有：
  1. **Agent Core**：`createSession` + 现有 fake model helper。断言：
     - 各内置工具（bash 前台 / 后台、read、edit、write 新建 / 覆盖 / 大文件、grep、glob、web_fetch、goal）的 `tool_execution_start` / `tool_execution_end` 携带预期 view 与 `kind`、`displayKey`。
     - MCP 工具给 `server` / `tool` 的 generic view；未知工具与 presenter 抛错时 view 为 `undefined` 且工具调用正常完成。
     - bash 结果 `details` 含 `exitCode` / `signal`；write 覆盖时 `details` 含旧内容或 patch。
     - resume 后 `messages` 投影重算出与 live 相同的 view；MCP 未连接时为 `undefined`。
     - `subagent_event` 内的工具事件带 view。
     - Headless stream-json 输出含 view；text 模式输出不变。
  2. **TUI**：app `start` helper + 注入的 headless terminal 与 fake host。断言：
     - 状态点三态与闪烁、失焦常亮；头部名称本地化（zh / en）与耗时 chip。
     - 3 / 8 行折叠、只多一行不折叠、提示文案；退出码在折叠时仍可见；展开 400 行窗口。
     - `ctrl+o` 全局展开（含 job 组），点击单卡切换，两者并集；路径点击不切换卡片。
     - hover 高亮与 `▾ / ▴`；标题截断时 tooltip 延迟出现，未截断时不出现。
     - unified diff；`auto` 下宽度 ≥110 列为 split，resize 跨阈值切换；`diffLayout` 强制值生效。
     - smooth reveal 只作用于 pending call view，resume / replay 立即完整显示（用显式 tick 或终端谓词等待，不靠时间猜测）。
     - 分流：todo / question / plan / 子代理不出工具行；todo 失败出错误卡；后台 bash 为 generic 卡 + JobCard。
     - transcript 搜索：`/` 进入、`n` / `N` 跳转、Esc 退出后 `/` 恢复为命令补全。
     - FileActionsPanel：三项动作调用 fake host 的 open / reveal / 复制。
     - 小终端：卡片、tooltip、菜单裁剪不破坏布局；展开 / 折叠时保持阅读位置与 bottom-follow。
     - resume 后卡片外观与 live 一致。
- 先例：`apps/neant-tui/tests/e2e/tools-and-notices.test.ts`（摘要与 `⎿`、错误 3 行）、`background-jobs.test.ts`（Ctrl+O 分组，将改为全局展开语义）、`plan-review.test.ts`、`todo-summary.test.ts`、`question-summary.test.ts`、`subagent-card.test.ts`、`resume.test.ts`；Agent Core 侧 `packages/agent/tests/e2e/` 中用 fake model 的工具场景。
- 现有依赖旧行为的测试（todo 工具卡摘要、`jobsExpanded`、plan review `▸ / ▾`、`name + JSON` 摘要）随实现同改同删。

## Out of Scope

- 工具参数流式呈现（args 完整前不建卡，与 dsh 一致）与前台 bash 实时输出尾随（实时输出只在 job 卡）。
- 按键重绑与 keymap 系统；`ctrl+o` 固定。
- 选择模式（Shift+↑ 进入、Enter 切换行）。
- FileActionsPanel 打开编辑器。
- read view 的 `lines` / `lang` 字段之外的富渲染（如行号栏）。
- Web 端实现本身；本 spec 只提供契约。
- Tool View 持久化与版本迁移。

## Further Notes

- 本 spec 推翻已定工单的部分呈现：[todo 工具](../agent-core-roadmap/issues/07-todo.md) 的工具卡 `todos ✓ done/total`、[向用户提问](../agent-core-roadmap/issues/09-ask-user.md) 与 [plan mode](../agent-core-roadmap/issues/10-plan-mode.md) 的调用行、[子代理](../agent-core-roadmap/issues/06-subagent.md) 的工具行；各工单已追加修订说明。
- dsh 有三套并行类别映射（点色按 id、名色按 `category`、`kind` 未用），本 spec 有意收敛为单一 `kind`。
- view 不持久化意味着 presenter 必须只依赖 Transcript 中的 toolCall 参数、toolResult 内容与 `details`；需要额外事实时补进 `details`，不读运行时状态。
- write 写前读取旧内容会增大 Transcript；上限与 diff 截断规则一致，超限退化为 patch。
- 改动跨 `@neant/shared`、`@neant/agent`、`@neant/tui`、`@neant/neant-tui`，且涉及 SessionEvent 形状（目前无外部事件消费方，可直接改）。
