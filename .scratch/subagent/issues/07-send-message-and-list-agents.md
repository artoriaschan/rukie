# 07: 续跑与子代理目录

**What to build:**

- `send_message { agent_id, message }`：只能发给本父 session 的子代理。目标正在运行时 steer 进去；空闲时开一个后台 run，按通知规则交回；返回 `delivered to <id>`。错误 id，或目标空闲且 running 已满时报错。
- `list_agents`：每行 `<id> [running|idle] — <description>`，没有子代理时返回 `(no subagents)`。
- 父 session 记 Tool State `subagents: [{ id, description, type }]`，version 1。resume 父 session 后全部为 idle，`send_message` 以子 session id 冷恢复，沿用原类型配置；类型已删除时回退 `general-purpose` 并告警。
- TUI：`send_message` 发起的 run 的卡片挂在该 `send_message` 工具卡下；父 session resume 时从 Tool State 初始化 idle 条目。

**Blocked by:** 02, 06

**Status:** claimed

参考：[spec](../spec.md)「模型工具」「Tool State 与 resume」。

- [x] e2e：给运行中的子代理 steer（子代理下一次模型请求可见）；给空闲的子代理开新 run 并通知
- [x] e2e：错误 id 报错；不能发给其他父 session 的子代理
- [x] e2e：`list_agents` 输出；resume 父 session 后全部为 idle，`send_message` 冷恢复且子代理保留原历史
- [x] TUI e2e：`send_message` 工具卡下出现对应卡片
- [x] `tsc -b` 与全量 `bun test` 通过

## Comments

- Implemented `send_message` active steering / idle background continuation and `list_agents`; directory snapshots persist as Tool State version 1. Cold continuation preserves child history, its own Todo List and original type; deleted types warn and fall back, while forks reuse their own copied entries without injecting later parent history.
- Parallel messages to the same idle child start one Run; the next message steers it. Idle continuation respects the fixed eight-running limit, while steering an active child remains available.
- TUI restores idle rows and displays the current card only under the latest initiating tool, including `send_message`.
- Validation: fresh baseline 1063 pass / 0 fail; final `env -u NO_COLOR bun run check` exited 0 with 1075 pass / 0 fail, 5825 assertions across 80 files. CLI tool-list expectation was extended for the two new tools; permission-review fixture now keeps its old history below main compaction and above the review half-window budget.
- Standards / Spec review pending with the coordinator. Status remains claimed until both reviews finish; main integration and managed worktree cleanup belong to the coordinator.
