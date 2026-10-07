# 07: 显示工具调用和系统提示

**What to build:** 用户能看到 agent 在做什么。每个工具调用显示一行“名字和参数摘要”，跑的时候带 spinner，结束后折叠成一行，用 ✓ 或 ✗ 表示结果，出错时显示错误的前几行。compaction 和 MCP server 报错显示成一行灰色提示。

Blocked by: 06

Status: resolved

- [x] 工具调用开始后，活动区出现“名字和参数摘要”（截断到一行）和 spinner
- [x] 结束后折叠成一行，用 ✓ 或 ✗ 表示结果，并进入 `Static`；出错时在下面显示错误的前几行
- [x] 一个 turn 里有多个工具调用时，各自独立显示和折叠
- [x] `compaction` 和 `mcp_server_error` 事件各显示一行暗色提示；system reminder 不显示
- [x] 测试走假终端 seam，用假 `streamFn` 返回工具调用
- [x] `bun run check` 全绿

## Comments

- 2026-10-02：会话视图按 toolCallId 独立跟踪活动调用，显示单行名字、JSON 参数摘要与动画 Spinner。完成后按完成顺序进入 Static，显示 ✓/✗；错误正文仅保留前三行，每行按终端宽度截断，成功结果正文不展开。
- compaction 显示压缩前 token 数，MCP server 错误显示 server 名和错误摘要；两者均为单行暗色提示并进入 scrollback。System Reminder 继续隐藏。TUI 避免把已由事件显示的 MCP 错误再写入 stderr，其他诊断沿用原有路径。
- 新增 4 项假终端端到端测试，位于 `apps/neant-tui/tests/e2e/tools-and-notices.test.ts`：动画及摘要截断、跨 Run 的单次 scrollback 输出、同名并行调用乱序完成及三行错误预览、MCP 提示与隐藏 reminder、compaction 提示与隐藏摘要。测试使用假 streamFn 和真实 Agent Core，公共启动辅助代码位于 `tests/helpers/app.ts`。
- code-review：Standards 的测试目录发现和 Spec 的 MCP stderr 重复输出发现均已修正；复审两轴无剩余发现。
- 最终 `bun run check` 全通过：格式、lint、`tsc -b`、Knip 和全仓库 206 tests / 1058 assertions；TUI frontend 为 30 tests。
