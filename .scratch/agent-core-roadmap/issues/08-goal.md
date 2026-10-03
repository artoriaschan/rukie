# 08: Goal

Type: grilling
Status: open
Blocked by: 02

## Question

Goal（见 `CONTEXT.md`）的剩余设计。

charting 中已定（参考 deepseek-harness `packages/goal`）：

- 续跑归 Agent Core（`Session` 内独立模块），Headless CLI 也可用。
- 照搬：每 session 一个 goal；phase `active|paused|blocked|complete` 持久、armed 仅进程内（resume 不自动开跑）；round = 带 goal 来源标记的用户消息，仅它计数；同一模型经工具判定 complete/blocked 后注入收尾消息；创建 / 编辑 / 暂停 / 恢复须人类当轮授权；默认上限 256 轮，超限转 blocked；错误 / 中止 / token 超限只 disarm。round 与收尾提示词照搬上游原文并注明来源。
- 简化：不做 revision CAS；不做"连续 3 轮才能 blocked"门槛。
- Permission Mode 为 `ask` 时不自动提权，设 goal 时提示建议切 `auto-review`。

需定：Agent Core API 形状（`setGoal` / `pauseGoal` …）；模型工具 schema；按地基 B 的事件形态；`/goal` 子命令集合；Headless CLI 入口（flag 形态）；TUI 呈现（状态栏 `goal n/max`、面板；面板已由 todo 工单定为复刻 dsh-TUI `GoalTodoPanel`，Goal 为根行，本工单补根行、`goal 存在` 时 todo 区块常显条件与状态栏 chip）；与 compaction 的交互（compaction 后 objective 如何保留）。
