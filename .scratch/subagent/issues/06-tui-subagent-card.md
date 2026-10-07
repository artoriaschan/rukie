# 06: TUI 子代理卡片

**What to build:** chat 屏幕从 `subagent_event` 折叠出每个子代理的视图模型（纯函数），并在发起它的工具卡（按 tool result `details.agentId`）下渲染卡片，完全复刻 dsh-TUI `SubagentMessage`：

- 无边框，`paddingLeft=2`。
- 头行：spinner（`/activity` 预设，120ms）或 🟢/🔴；粗体 `子代理：` + description；然后用 dim `·` 分隔 `provider/model`、effort（父 thinking 级别）、时长、`N tok`、`N tools`、彩色状态。
- 颜色：completed 为 `success`，failed / aborted 为 `error`，running 为 `warning`；hover 时符号和标题为 `accent`。
- 运行中加一行当前工具，再加固定 3 行 dim 的 `  │ <line>`。
- 结束后只剩头行，失败时加 `  └ <error>`。

所有 running 子代理都在跑而父 agent 空闲时，显示 `waiting for N subagents`。新文案进 i18n（zh / en）。点击进入详情由工单 08 接上。

Blocked by: 02

Status: resolved

参考：[spec](../spec.md)「TUI」中的「子代理状态」「消息流卡片」「父代理等待」；dsh-TUI `src/components/Chat/SubagentMessage.tsx`。

- [x] TUI e2e：运行中 / 完成 / 失败三种状态的卡片快照
- [x] TUI e2e：运行中卡片高度固定，输出行只保留最近 3 行
- [x] TUI e2e：`waiting for N subagents` 文案
- [x] 组件为 ③ 层、只接收 props；i18n 无硬编码汉字（`hardcoded-han` 测试通过）
- [x] `tsc -b` 与全量 `bun test` 通过

## Comments

- 2026-10-04: Implemented the props-only layer ③ `SubagentMessage`, adapted from the actual dsh-TUI card and event projection with MIT attribution. Running cards use the existing shared activity clock at 120ms, reserve one current-tool row plus three hard-clipped output rows, and collapse after completion/failure/abort. Status colors, hover colors, parent effort, model, duration, tokens and tool count are rendered from props.
- `screens/chat/subagents.ts` owns pure immutable child event folding; parent conversation/activity remains independent. Cards attach through tool result `details.agentId`; parent waiting uses `subagents_waiting`, clears on parent agent/Turn restart and tracks remaining children. All new labels are in the zh/en TUI dictionary. The reusable view model preserves typed output/tool lists for later tickets; defensive `[{ id, description, type }]` Tool State initialization creates idle entries. Actual persisted resume integration awaits ticket 07, which registers that Tool State.
- Public TDD: running/completed/failed snapshots, streamed text/thinking, cross-Turn tail output, fixed height and wide/multiline content at 40/80 columns, terminal cell status/tool/hover colors, click callback, zh/en waiting, parent continuation and Esc cascading abort. Targeted validation: **14 tests / 65 assertions** passed; regular `tsc -b` passed.
- Final validation: `rtk proxy env -u NO_COLOR bun run check` exited **0**, with **1017 tests / 5548 assertions / 75 files** in 113.74s; formatting, lint, `tsc -b`, Knip and hardcoded-Han checks passed. Log: `/tmp/neant-subagent-06-final-check.log`.
- Status remains `claimed` pending coordinator-owned independent `/code-review` Standards and Spec axes against `f16ea9e2253ae925f8b6ef3abe36f230e50af7cd`. Dashboard/detail/panel navigation remain owned by 08/09; this component exposes the click prop for that wiring. Main integration and worktree removal are coordinator-owned.

- 2026-10-04 review correction: initial independent Standards review found 0 issues; Spec found one P2 parity issue (previous/current tool names were always accent). Added `toolNameMutate=#E5C07B` and `toolNameExec=#56B6C2`, plus a pure layer ② `toolNameColor` public helper with the reference's case-insensitive category mapping. `SubagentMessage` consumes the helper downward through `@neant/tui`; existing ToolCall behavior is unchanged.
- Public terminal-cell bash/write regression tests failed with the original accent color, then passed with category colors. Independent Spec re-review confirmed the P2 fixed and found 0 new issues; Standards re-review confirmed 0 documented violations / 0 substantiated smells, including the helper's layer ownership and absence of Agent Core dependencies. Both reviewers independently ran **16 tests / 71 assertions / 0 failures**.
- Post-fix full validation: `rtk proxy env -u NO_COLOR bun run check` exited **0**, with **1019 tests / 5554 assertions / 75 files** in 113.71s; formatting, lint, `tsc -b`, Knip and hardcoded-Han checks passed. Log: `/tmp/neant-subagent-06-color-fix-check.log`. Ticket 06 is resolved; main integration remains coordinator-owned.
