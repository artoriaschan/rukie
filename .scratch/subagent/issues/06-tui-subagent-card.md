# 06: TUI 子代理卡片

**What to build:** chat 屏幕从 `subagent_event` 折叠出每个子代理的视图模型（纯函数），并在发起它的工具卡（按 tool result `details.agentId`）下渲染卡片，完全复刻 dsh-TUI `SubagentMessage`：

- 无边框，`paddingLeft=2`。
- 头行：spinner（`/activity` 预设，120ms）或 🟢/🔴；粗体 `子代理：` + description；然后用 dim `·` 分隔 `provider/model`、effort（父 thinking 级别）、时长、`N tok`、`N tools`、彩色状态。
- 颜色：completed 为 `success`，failed / aborted 为 `error`，running 为 `warning`；hover 时符号和标题为 `accent`。
- 运行中加一行当前工具，再加固定 3 行 dim 的 `  │ <line>`。
- 结束后只剩头行，失败时加 `  └ <error>`。

所有 running 子代理都在跑而父 agent 空闲时，显示 `waiting for N subagents`。新文案进 i18n（zh / en）。点击进入详情由工单 08 接上。

**Blocked by:** 02

**Status:** ready-for-agent

参考：[spec](../spec.md)「TUI」中的「子代理状态」「消息流卡片」「父代理等待」；dsh-TUI `src/components/Chat/SubagentMessage.tsx`。

- [ ] TUI e2e：运行中 / 完成 / 失败三种状态的卡片快照
- [ ] TUI e2e：运行中卡片高度固定，输出行只保留最近 3 行
- [ ] TUI e2e：`waiting for N subagents` 文案
- [ ] 组件为 ③ 层、只接收 props；i18n 无硬编码汉字（`hardcoded-han` 测试通过）
- [ ] `tsc -b` 与全量 `bun test` 通过
