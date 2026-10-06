# 06: `/context` 上下文报告

**What to build:** 用户在 TUI 输入 `/context`，对话区出现一条静态快照：复刻 Claude Code 的 token 格子图、按类别的图例和明细区，一眼看出上下文被什么占满。见 [spec](../spec.md) 的“上下文报告”与“TUI：选择器与界面”。

**Blocked by:** 01（命令框架与补全菜单）

**Status:** resolved

- [x] Session 新增 `contextReport()`（只读，空闲与 run 中都可用）：`model`、`window`、`used`（优先最近一次 response 的 input tokens，否则估算总和）、`categories[]`、`memoryFiles[]`、`mcpTools[]`、`skills[]`、`agentTypes[]`
- [x] 类别：System prompt（仅系统提示词）、Memory files（`user-instructions` / `project-instructions` reminder 当前内容，按路径）、System tools（含子代理类型）、MCP tools、Skills（列表 reminder）、Messages（其余，不重复计）、Compaction 预留（窗口 20%）、Free space（≥0）；细分用 chars/4；现有 `context_usage` 不变
- [x] TUI 组件复刻 Claude Code `ContextVisualization`：宽屏左格子右图例，窄屏或空间不足时上下排列；10×10，窗口 ≥1M 为 20×10，终端 <80 列缩为 5×5（1M 为 5×10）；`⛁` 满格、`⛀` 不足 70%、`⛶` 空闲、`⛝` 预留；报告内使用截图参考配色，每个非空类别至少占一格
- [x] 图例：模型名称与窗口、模型 ID、`used/window tokens (pct%)` 三行，斜体 `Estimated usage by category`，只显示非零类别，符号着色、数值灰色、k/m 缩写；下方显示 MCP tools / 子代理类型 / Memory files / Skills 的数量与 token 摘要，`/context all` 展开 `└ name: N tokens` 明细
- [x] 渲染为对话区本地静态条目，不进 Agent Core transcript；run 中可用
- [x] Agent Core e2e（Memory files 不重复计入 Messages、明细、预留、真实 usage 优先）与 TUI 测试（符号、图例、窄终端）覆盖以上行为

## Answer

Implemented read-only `Session.contextReport()` with stable category ids and a shared report type used by Core and TUI. Prompt text and current tool declarations replay native system deltas. Current user/project file and skills catalog snapshots receive separate categories and details; superseded snapshots remain Messages because they still occupy restored context. Inline Skill Invocation expansion is counted. MCP identities retain discovery metadata and recover from stored server reminders on resume, including server/tool names with separators. Agent type details come from the restored subagent declaration and are already included in System tools.

Reports prefer the latest response input plus cache usage, including after resume, while preserving existing `context_usage` event behavior. Model switching, compaction and rewind invalidate the stored count. Free space clamps at zero; compaction reserve is 20 percent. Raw category estimates remain independent from provider totals.

The props-only `ContextVisualization` implements the specified grid/legend contract with Neant theme colors, all four symbols, 10×10 / 20×10 / narrow 5×5 / 5×10 dimensions, translated labels and details. `/context` appends a local immutable snapshot and works during a Run; it never calls the model or enters the transcript.

Validation on latest integration base including 03/08: 97 affected Core/TUI/i18n tests passed, 0 failed, 751 assertions. This includes report memory exclusivity, historical snapshots, tool declaration replacement, MCP rediscovery/resume, provider input/cache priority, model/compaction invalidation, skill invocation, all grid sizes/symbols, active-run snapshot stability and prompt isolation. Formatting, lint, TypeScript and knip passed. Final integration full check belongs to the complete spec delivery.

最终完整检查的同步纠正：provider usage 在 assistant message 结束时已发出，但 Stop hook、存储关闭和 Run 收尾仍可待完成；只等 `0.6%` / `0.9%` 不能代表允许下一条普通 prompt。原测试在此窗口提交时输入按 busy 规则保留草稿。公开 `start()` 测试加入受控 Stop HTTP hook，确定复现 usage 可见而 spinner 仍在、旧顺序第二请求不出现；修复测试为释放 hook 并等待终端 `!app.isWorking()`，两次 response 后均观察 idle 再提交。生产行为和超时未改。Red/green 日志：`/tmp/neant-slash-context-readiness-red.log` / `/tmp/neant-slash-context-readiness-green.log`。

同步纠正验证：title、context、resume、side-question 和 Core session-list 共 5 个受影响文件连续 5 次均为 27 pass / 0 fail / 160 assertions（合计 135 pass / 0 fail / 800 assertions），日志 `/tmp/neant-slash-readiness-repeat-{1..5}.log`；oxfmt、oxlint、tsc -b、knip 和 git diff --check 通过。整个 integration 的 final full check 由 root 执行。

### 2026-10-06 截图样式复刻

按用户提供的 Claude Code 截图调整命令背景、缩进标题、带空格的容量网格、三行模型信息、图例的颜色与斜体、下方资源摘要和 `/context all` 展开提示。保留 Neant 分类与 20% 压缩预留；子代理类型仍计入 System tools，避免为展示重复计数。两种命令仍仅追加本地不可变快照。

公开终端测试覆盖四种网格、provider 快照保持、Run 中展开、中文文案、实际 RGB cell 颜色与加粗/斜体，以及从 120 列缩到 60/40 列后的上下布局。聚焦验证：`env -u NO_COLOR bun test apps/neant-tui/tests/screens/chat/context-report.test.ts apps/neant-tui/tests/screens/chat/slash-menu-parity.test.ts`，15 pass、0 fail、135 assertions。初次颜色检查受到宿主 NO_COLOR 影响；清除后原命令菜单与新报告颜色均通过。完整检查：在隔离临时 HOME、清除 NO_COLOR 并使用 caffeinate 的环境下执行 `bun run check`，退出 0；oxfmt、oxlint、tsc -b、Knip 全部通过，2189 pass、0 fail、11283 assertions、156 files，253.35s。日志：`/tmp/neant-context-style-check.log`。补充文档格式检查和 `git diff --check` 均通过。

### 2026-10-06 主分支整合与清理

实现提交 `6b286b694dc417e9c139e3fe05f6840ba35271ec` 已合入本地 `main`，合并提交为 `10f30715c6a3e07f448971d535915c2fcaa651e3`。在主工作目录、隔离临时 HOME、清除 NO_COLOR 并使用 caffeinate 的环境下执行 `bun run check`，退出 0：oxfmt、oxlint、tsc -b、Knip 全部通过，2195 pass、0 fail、11331 assertions、158 files，268.07s。日志：`/tmp/neant-context-style-main-check.log`。

清理前确认本任务工作树 `928d/Neant` 无未提交或非忽略的未跟踪文件，`main..HEAD` 为 0；已用 `git worktree remove` 移除，目录不存在且 Git 工作树列表不再包含它。应用归档接口拒绝归档聊天的主工作树，因此本次通过 Git 直接移除，提交由 main 保留。其他工作树及 main 上独立进行的文档修改均保留。本任务使用 detached HEAD，未创建临时分支。

### 2026-10-06 命令行改用用户消息样式

按用户补充要求，`/context` 和 `/context all` 的命令行复用现有 `UserMessage`，采用相同主题色、加粗、两列悬挂缩进并移除背景色；报告主体的网格、分类配色、图例和资源摘要保持。公开终端测试对比普通用户消息与两种命令的前景色和加粗，确认文字、前缀及尾部空白均无背景填充。原实现先在 `isBgDefault()` 断言处失败，复用后通过。

验证：清除 NO_COLOR 后运行 context-report 与 UserMessage 两个文件，13 pass、0 fail、180 assertions。隔离 HOME、清除 NO_COLOR 并使用 caffeinate 运行完整 `bun run check`：格式、lint、类型检查、Knip 通过；2194 pass、1 fail、11350 assertions、158 files，280.58s，退出 1。失败项为权限测试 `the question stays visible above a multiline draft and restores the draft after cancellation`（取消后提交草稿的时序），单独重跑仍失败；使用修改前 HEAD 的隔离副本重跑同项也失败，确认属于原有 main 问题。完整日志 `/tmp/neant-context-user-style-check.log`，基线复现日志 `/tmp/neant-context-user-style-baseline.log`。
