# 06: `/context` 上下文报告

**What to build:** 用户在 TUI 输入 `/context`，对话区出现一条静态快照：复刻 Claude Code 的 token 格子图、按类别的图例和明细区，一眼看出上下文被什么占满。见 [spec](../spec.md) 的“上下文报告”与“TUI：选择器与界面”。

**Blocked by:** 01（命令框架与补全菜单）

**Status:** ready-for-agent

- [ ] Session 新增 `contextReport()`（只读，空闲与 run 中都可用）：`model`、`window`、`used`（优先最近一次 response 的 input tokens，否则估算总和）、`categories[]`、`memoryFiles[]`、`mcpTools[]`、`skills[]`、`agentTypes[]`
- [ ] 类别：System prompt（仅系统提示词）、Memory files（`user-instructions` / `project-instructions` reminder 当前内容，按路径）、System tools（含子代理类型）、MCP tools、Skills（列表 reminder）、Messages（其余，不重复计）、Compaction 预留（窗口 20%）、Free space（≥0）；细分用 chars/4；现有 `context_usage` 不变
- [ ] TUI 组件复刻 Claude Code `ContextVisualization`：左格子右图例；10×10，窗口 ≥1M 为 20×10，终端 <80 列缩为 5×5（1M 为 5×10）；`⛁` 满格、`⛀` 不足 70%、`⛶` 空闲、`⛝` 预留；每类配色映射 Neant 主题 token
- [ ] 图例：`model · used/window tokens (pct%)`、`Estimated usage by category`、逐类 `⛁ 类别: N tokens (p%)`；明细区 MCP tools / Memory files / Skills / 子代理类型，`└ name: N tokens`
- [ ] 渲染为对话区本地静态条目，不进 Agent Core transcript；run 中可用
- [ ] Agent Core e2e（Memory files 不重复计入 Messages、明细、预留、真实 usage 优先）与 TUI 测试（符号、图例、窄终端）覆盖以上行为
