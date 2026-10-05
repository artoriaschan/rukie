# 08: Goal

Type: grilling
Status: resolved
Blocked by: 02

## Question

Goal（见 `CONTEXT.md`）的剩余设计。

charting 中已定（参考 deepseek-harness `packages/goal`）：

- 续跑归 Agent Core（`Session` 内独立模块），Headless CLI 也可用。
- 照搬：每 session 一个 goal；phase `active|paused|blocked|complete` 持久、armed 仅进程内（resume 不自动开跑）；round = 带 goal 来源标记的用户消息，仅它计数；同一模型经工具判定 complete/blocked 后注入收尾消息；创建 / 编辑 / 暂停 / 恢复须人类当轮授权；默认上限 256 轮，超限转 blocked；错误 / 中止 / token 超限只 disarm。round 与收尾提示词照搬上游原文并注明来源。
- 简化：不做 revision CAS；不做"连续 3 轮才能 blocked"门槛。
- Permission Mode 为 `ask` 时不自动提权，设 goal 时提示建议切 `auto-review`。

需定：Agent Core API 形状（`setGoal` / `pauseGoal` …）；模型工具 schema；按地基 B 的事件形态；`/goal` 子命令集合；Headless CLI 入口（flag 形态）；TUI 呈现（状态栏 `goal n/max`、面板；面板已由 todo 工单定为复刻 dsh-TUI `GoalTodoPanel`，Goal 为根行，本工单补根行、`goal 存在` 时 todo 区块常显条件与状态栏 chip）；与 compaction 的交互（compaction 后 objective 如何保留）。

## Comments

- 2026-10-04：[hooks](12-hooks.md) 定 Stop hook 可 block 续跑：run 结束先跑 Stop hook，hook 放行后才轮到 Goal；hook 续跑不算 goal round。Stop 与 Goal 都挂 Session run 层（子代理全部结束后），Goal 排在 Stop 之后，由代码顺序保证；与 deepseek-harness 一致（DSH Stop 在 `agent/turn-stopping`，goal driver 只在 idle 后起 round）。

## Answer

2026-10-05 grilling 结论。参考：deepseek-harness `packages/goal/{goal,tool-goal,command-goal,goal-round-driver}`；dsh-TUI `src/components/GoalTodoPanel.tsx`、`src/screens/StatusLine.tsx`、`src/dsh-adapter/channel/transcript.ts`。

1. **Agent Core API：** Session 暴露 `readonly goal: GoalView | undefined`（`phase` / `objective` / `roundsStarted` / `maxRounds` / `blockedReason?` / `armed`），以及 `createGoal(objective, { maxRounds? })`、`editGoal(objective)`、`pauseGoal()`、`resumeGoal()`、`clearGoal()`。edit 不重置 round 计数；对 complete 的 goal 执行 edit 等于新建（照 DSH）。仅顶层 session 有。
2. **模型工具：** `create_goal { objective, max_goal_rounds? }` 与 `update_goal { action: edit|pause|resume|complete|blocked, objective?, blocked_reason? }`。不做 `get_goal`：无 CAS，不需要取 revision；当前状态由 round 消息和 goal reminder 给出。照搬 round 提示词时删去"先读 goal"那句，并注明改动。工具名沿用 Codex/DSH（CC 无同名工具）。授权照 DSH：create/edit/pause/resume 需当轮有直接人类输入；complete/blocked 也允许在当前 goal round 内调用；模型不能 resume 一个 paused 的 goal。run 中用户 pause 后模型又 complete：允许，complete 覆盖 paused（无 CAS 时接受的边角）。
3. **反馈给模型：** 新增 `goal` ReminderSource，内容是 objective、phase、round n/max；goal 存在且未 complete 时注入，compaction 后立即重注入（地基 B 默认机制），以此解决 compaction 后 objective 丢失。工具使用规范写在工具 description 里，不进 System Prompt。
4. **事件：** 持久字段的变化走 `tool_state_changed(goal)`。不加 `goal_activation_changed`：armed 的每个变化点都伴随 Tool State 变化或 run 结束，frontend 需要时读 `session.goal.armed`。以后若出现不伴随其他事件的 armed 变化，再加。
5. **`/goal`：** 文法照 DSH：`/goal`（查看）、`/goal <objective>`、`/goal edit <objective>`、`pause`、`resume`、`clear`。create 后立即 armed，空闲时马上开第 1 轮。查看任何时候都能用；`pause` / `clear` 在 run 中也能用，只 disarm，不打断当前 run（打断仍用 Esc）；create / edit / resume 仅空闲可用。
6. **Headless CLI：** `neant --goal "<objective>" [--max-goal-rounds N]`，与 `-p` 互斥，跑到 complete、blocked、超限或出错为止。退出码：complete 为 0，blocked 或超限为 1。`--resume <id> --goal` 时若已有未完成的 goal，报错并提示用 TUI 处理。stream-json 不新增事件类型。
7. **TUI（复刻 dsh-TUI）：**
   - 面板根行：`🎯 <objective>`（bold、truncate），右侧 PhaseBadge `● active · 3/256 · 1m12s`。phase 标签为 `● active` / `⏸ paused` / `⛔ blocked` / `✓ complete`；颜色 active 为 success、paused 为 warning、blocked 为 error、complete 为 dim。
   - 计时器由面板本地维护：按 goal 首次渲染开始，complete 时冻结。
   - blocked 时多一行 `│ <reason>`（error 色）。
   - goal 存在时 todo 区块常显。
   - statusline chip：`● 3/256`，按 phase 着色，排在 chip 最前。不做 `statusBar.goal` 开关（`/settings` 仍是占位）。
   - 工具卡：`🎯 objective` / `● active · 3/256 · armed` / blocked 时加 `⛔ reason`。
   - goal round 消息与收尾消息不渲染成气泡。
   - `/goal` 查看用 notice 输出 Status、Blocker、Objective、Rounds、Activation，以及当前状态下可用的命令提示（照 DSH `commandHint`）。
8. **用户插话：** goal armed 时用户发消息，该 run 结束后续跑照常；用户这一轮不计 round。
9. **子代理：** 不可用；不注册 goal 工具，子 session 也不暴露 Goal API。
10. **上限：** 默认 256，不加 settings 键；可经 `create_goal` 参数或 `--max-goal-rounds` 覆盖。

Spec：[Goal spec](../../goal/spec.md)（ready-for-agent）。
