Status: ready-for-agent

# Spec: Goal

来源：[Goal](../agent-core-roadmap/issues/08-goal.md)；依赖 [地基 B：工具状态进 transcript](../agent-core-roadmap/issues/02-tool-state-in-transcript.md)（Tool State、reminder、compaction 后重注入）、[todo 工具](../agent-core-roadmap/issues/07-todo.md)（`GoalTodoPanel`）、[hooks](../agent-core-roadmap/issues/12-hooks.md)（Stop hook 先于 Goal）、[自定义 Slash Command 与手动 compaction](../agent-core-roadmap/issues/16-slash-commands-and-manual-compaction.md)（`/goal` 占位）。术语见 `CONTEXT.md` 的 Goal、Tool State、Run、Session Resume、Compaction。参考：deepseek-harness `packages/goal/{goal,tool-goal,command-goal,goal-round-driver}`；dsh-TUI `GoalTodoPanel.tsx`、`StatusLine.tsx`、`dsh-adapter/channel/transcript.ts`。

## Problem Statement

做长任务（"把这个模块迁移完并让测试全绿"）时，agent 每个 run 结束都停下来等我，我得反复敲"继续"。离开终端一会儿，回来发现它半小时前就停在第二步。没有办法告诉它"一直做到目标达成或真的卡住为止"，也看不到它在朝什么目标做、做了几轮。上下文被压缩之后，它甚至可能忘了最初的目标。Headless 下更不行，`neant -p` 一个 run 就退出。

## Solution

用户可以给 session 设一个 Goal：TUI 用 `/goal <objective>`，Headless 用 `neant --goal "<objective>"`，或者直接让模型用 `create_goal` 从请求里推断。设定后 Agent Core 在每个 run 结束时自动发起下一轮（goal round），直到模型判定目标 complete 或 blocked、用户 pause / clear，或达到续跑上限（默认 256 轮，超限转 blocked）。出错、中止、token 超限只停止自动续跑，goal 本身保留，用户可以 resume。Goal 作为 Tool State 持久化，resume 后仍在但不会自动开跑。objective 通过 system reminder 一直对模型可见，compaction 之后立即补上。TUI 复刻 dsh-TUI：输入框上方面板的 🎯 根行、statusline 的 phase chip、goal 工具卡。

## User Stories

1. 作为 TUI 用户，我想输入 `/goal <objective>` 设定目标，这样 agent 会自动持续工作直到目标达成。
2. 作为 TUI 用户，我想设定 goal 后 agent 在空闲时立刻开始第 1 轮，这样我不用再发一条 prompt。
3. 作为 TUI 用户，我想每个 run 结束后 agent 自动开始下一轮，这样我离开终端时工作不会停。
4. 作为 TUI 用户，我想输入 `/goal` 查看当前 goal 的状态、objective、轮次和是否在自动续跑，这样我知道它进行到哪儿了。
5. 作为 TUI 用户，我想 `/goal` 查看结果里列出当前状态下可用的子命令，这样我不用记文法。
6. 作为 TUI 用户，没有 goal 时 `/goal` 告诉我"当前没有 goal"并给出用法，这样我知道怎么开始。
7. 作为 TUI 用户，我想用 `/goal edit <objective>` 修改目标，这样方向变了不用从头来。
8. 作为 TUI 用户，我想 edit 不重置轮次计数，这样上限仍然约束总工作量。
9. 作为 TUI 用户，我想对已 complete 的 goal 执行 `/goal edit` 时直接新建一个 goal，这样我能顺势开始下一个目标。
10. 作为 TUI 用户，我想已有未完成 goal 时 `/goal <objective>` 报错并提示用 edit 或 clear，这样我不会误覆盖进行中的目标。
11. 作为 TUI 用户，已 complete 的 goal 允许我直接 `/goal <objective>` 新建，这样不用先 clear。
12. 作为 TUI 用户，我想 run 进行中也能 `/goal pause`，这样当前 run 结束后不再续跑。
13. 作为 TUI 用户，我想 pause 不打断当前 run，这样正在进行的工具调用能正常收尾；要立刻停仍用 Esc。
14. 作为 TUI 用户，我想 `/goal resume` 恢复 paused 或 blocked 的 goal，这样问题解决后能继续。
15. 作为 TUI 用户，我想 resume 一个 active 但未在续跑的 goal（如 session 恢复后）时重新开始续跑，这样恢复会话后能接着跑。
16. 作为 TUI 用户，我想 `/goal clear` 删除 goal，run 中也可用，这样我能彻底放弃这个目标。
17. 作为 TUI 用户，我想 run 中输入 create / edit / resume 时得到"仅空闲可用"的提示，这样我知道为什么没生效。
18. 作为 TUI 用户，我想 `/goal edit` 不带 objective 时得到错误提示，这样不会把目标改成空。
19. 作为 TUI 用户，我想对当前状态不合法的子命令（如 pause 一个已 paused 的 goal）得到明确的错误，而不是静默无效。
20. 作为用户，我想直接说"一直做到所有测试通过为止"，模型就用 `create_goal` 替我设 goal，这样我不必知道 `/goal` 命令。
21. 作为用户，我想模型只在我当轮直接请求时才能创建、修改、暂停、恢复 goal，这样它不会在自动续跑中自己改目标。
22. 作为用户，我想模型在自动续跑轮次中能把 goal 标记为 complete，这样目标达成后自动停下。
23. 作为用户，我想模型在真的卡住时把 goal 标记为 blocked 并写明原因，这样我知道需要我做什么。
24. 作为用户，我想模型不能 resume 一个被我 pause 的 goal，这样我的暂停决定不会被推翻。
25. 作为用户，我想 goal complete 或 blocked 之后模型给我写一段收尾说明（结果、做了什么、怎么验证的、需要我做什么），这样我回来能直接看结论。
26. 作为用户，我想收尾说明只陈述 session 里实际发生的事，这样不会被编造的结果误导。
27. 作为用户，我想 run 中我 pause 之后模型仍然可以把 goal 标为 complete，这样已经完成的事实不被暂停掩盖。
28. 作为用户，我想 goal 达到续跑上限（默认 256 轮）时转为 blocked 并说明原因，这样失控的循环有上限。
29. 作为用户，我想创建 goal 时可以指定更小的上限，这样小任务不会跑太久。
30. 作为用户，我想 run 出错、被我中止或 token 超限时只停止自动续跑、goal 保留，这样我能修完问题再 resume。
31. 作为用户，我想 goal 在续跑中我自己插一句话，这一轮结束后 goal 照常继续，这样我能随时纠偏而不打断目标。
32. 作为用户，我想我自己发起的 run 不计入 goal 轮次，这样计数只反映自动续跑。
33. 作为用户，我想 goal 存在时模型每个 run 开始都能看到 objective、状态和轮次，这样它不会忘了目标。
34. 作为用户，我想 compaction 之后模型立即重新看到 objective，这样长任务压缩后不偏题。
35. 作为用户，我想 goal complete 后不再向模型注入 goal reminder，这样已完成的目标不占上下文。
36. 作为用户，我想 goal reminder 内容不变时不重复注入，这样不浪费 token。
37. 作为用户，我想 goal 在 Stop hook 之后才判定续跑，这样 hook 的 block 续跑与 goal 续跑不冲突。
38. 作为用户，我想 Stop hook 的续跑不计入 goal 轮次，这样计数口径一致。
39. 作为用户，我想子代理全部结束之后父 session 才开下一轮 goal，这样不会和后台子代理交错。
40. 作为用户，我想 goal 随 session 持久化，resume 后仍能看到它的状态、objective 和轮次，这样关掉终端不丢目标。
41. 作为用户，我想 resume 后 goal 不会自动开跑，这样重新打开会话不会出乎意料地立即消耗 token。
42. 作为用户，我想 rewind 到某个 prompt 之前时 goal 状态回到那一刻，这样对话和目标保持一致。
43. 作为用户，我想 fork session 时 goal 状态随分支带走但不会自动开跑。
44. 作为用户，我想 Permission Mode 为 `ask` 时设 goal 收到提示，建议切到 `auto-review`，这样我知道为什么续跑会卡在审批上。
45. 作为用户，我想 Permission Mode 不会因为设 goal 自动提权，这样安全边界由我控制。
46. 作为用户，我想子代理不能创建或操作 goal，这样只有顶层会话有一个目标。
47. 作为 TUI 用户，我想输入框上方的面板显示 `🎯 <objective>` 根行，这样一眼看到当前目标。
48. 作为 TUI 用户，我想根行右侧显示 phase 标签、轮次和已用时间（如 `● active · 3/256 · 1m12s`），这样知道进度。
49. 作为 TUI 用户，我想 phase 按颜色区分（active 绿、paused 黄、blocked 红、complete 暗），这样不读字也能判断。
50. 作为 TUI 用户，我想 goal complete 后计时冻结，这样看到总耗时。
51. 作为 TUI 用户，我想 blocked 时根行下多一行红色的原因，这样不必翻对话找原因。
52. 作为 TUI 用户，我想 objective 太长时截断在一行内，这样面板不撑高。
53. 作为 TUI 用户，我想 goal 存在时 todo 区块挂在 goal 根行下且始终显示，这样目标与步骤是一棵树。
54. 作为 TUI 用户，我想 `ctrl+q` 仍能折叠 todo 区块，goal 根行保持可见。
55. 作为 TUI 用户，我想 statusline 最前面显示 `● 3/256` chip，按 phase 着色，这样面板折叠或滚动时也能看到 goal 状态。
56. 作为 TUI 用户，我想没有 goal 时 chip 和根行都不显示。
57. 作为 TUI 用户，我想 `create_goal` / `update_goal` 工具卡显示 objective、phase、轮次与是否在续跑，blocked 时显示原因，而不是原始 JSON。
58. 作为 TUI 用户，我想 goal 轮次消息和收尾指令不作为用户气泡出现在对话里，这样对话流只有我说的话和 agent 的回答。
59. 作为 TUI 用户，我想 resume 一个带 goal 的 session 后面板和 chip 立刻显示 goal 状态。
60. 作为 TUI 用户，我想 goal 状态变化（create / edit / pause / resume / complete / blocked / clear / 轮次推进）实时反映在面板与 chip 上。
61. 作为 TUI 用户，我想 `/goal` 在补全菜单中出现并带参数提示，这样我能发现它。
62. 作为 TUI 用户，我想所有 Goal 文案有中英两份，这样跟随我的 locale。
63. 作为 Headless 用户，我想 `neant --goal "<objective>"` 一直跑到 goal 结束，这样能在脚本或 CI 里无人值守地完成长任务。
64. 作为 Headless 用户，我想用 `--max-goal-rounds N` 限制轮次，这样控制成本。
65. 作为 Headless 用户，我想 goal complete 时退出码为 0，blocked 或超限时为 1，这样脚本能判断成败。
66. 作为 Headless 用户，我想 run 出错时按现有错误退出码退出，这样和 `-p` 行为一致。
67. 作为 Headless 用户，我想 `--goal` 与 `-p` 同时给出时报错，这样不会误解哪个是目标。
68. 作为 Headless 用户，我想 `--resume <id> --goal "<objective>"` 在该 session 已有未完成 goal 时报错并提示用 TUI 处理，这样不会静默覆盖。
69. 作为 Headless 用户，我想 `--resume <id> --goal "<objective>"` 在该 session 无 goal 或 goal 已 complete 时新建并跑完，这样能在旧会话上续做新目标。
70. 作为 Headless 用户，我想 text 输出里依次看到每一轮的回答和最终收尾说明。
71. 作为 Headless 用户，我想 stream-json 输出里能通过 `tool_state_changed` 事件跟踪 goal 状态，这样外部工具不需要新的事件类型。
72. 作为 Headless 用户，我想 Headless 下没有回调的交互取安全默认值（审批 deny），这样 goal 不会因为一次交互卡死。
73. 作为 frontend 开发者，我想 Session 暴露只读的 `goal` 视图和 create / edit / pause / resume / clear 方法，这样 TUI 与 CLI 共用一套语义。
74. 作为 frontend 开发者，我想对非法状态的调用抛出明确错误，这样 frontend 能把它渲染成提示。
75. 作为 frontend 开发者，我想通过 `tool_state_changed(goal)` 和 run 结束事件就能知道何时重读 `session.goal`，这样不需要额外订阅。
76. 作为 Neant 维护者，我想 round 与收尾提示词照搬 DSH 原文并注明来源与改动，这样行为可追溯。
77. 作为 Neant 维护者，我想 goal 的坏 Tool State 记录被跳过并告警，session 照常 resume。

## Implementation Decisions

- **新模块 `packages/agent` 的 `goal/` 目录**（一个概念一个目录，经 `index.ts` 暴露）：Tool State 定义、reminder 渲染、round 与收尾提示词、两个模型工具、授权判定。Session 只做接线与续跑调度。
- **Tool State `goal`**（version 1）：快照为 `{ id, objective, phase, roundsStarted, maxRounds, blockedReason? }`，`phase ∈ active|paused|blocked|complete`，`blockedReason` 仅在 blocked 时存在。clear 写一条 `null` 快照（tombstone）。每次变化（含 round 推进）写一份完整快照，last-wins；坏记录跳过并经 `onWarning` 告警（地基 B）。`armed` 不入快照，进程内易失。rewind / fork 随分支自然恢复，恢复出的 goal 一律 disarmed。不做 revision / CAS。
- **Session API**（仅顶层 session；子 session 上 `goal` 恒为 undefined，方法抛错）：
  ```ts
  interface GoalView {
    id: string; objective: string; phase: "active" | "paused" | "blocked" | "complete";
    roundsStarted: number; maxRounds: number; blockedReason?: string; armed: boolean;
  }
  readonly goal: GoalView | undefined;
  createGoal(objective: string, options?: { maxRounds?: number }): Promise<GoalView>;
  editGoal(objective: string): Promise<GoalView>;
  pauseGoal(): Promise<GoalView>;
  resumeGoal(): Promise<GoalView>;
  clearGoal(): Promise<void>;
  ```
  - `createGoal`：仅空闲；已有非 complete goal 时抛错；新 id，`roundsStarted = 0`，`maxRounds` 默认 256（正整数校验），phase active、armed，随即调度续跑（空闲时立即开第 1 轮）。
  - `editGoal`：仅空闲；无 goal 抛错；complete 时等同 `createGoal`；否则只替换 objective，phase 与轮次不变，不改变 armed。
  - `pauseGoal`：run 中也可用；仅 active 可 pause；phase → paused、disarm；不打断当前 run。
  - `resumeGoal`：仅空闲；paused / blocked / active-未 armed 可 resume，complete 抛错；phase → active、armed，随即调度续跑。从 blocked resume 时清除 `blockedReason`；若已达上限则先抛错，提示 edit 或新建。
  - `clearGoal`：run 中也可用；写 tombstone、disarm；无 goal 时为 no-op。
  - 非法状态一律抛带可读信息的错误，frontend 渲染成提示。
  - `createGoal` / `resumeGoal` 时若 Permission Mode 为 `ask`，经 `onWarning` 提示建议切 `auto-review`；不自动改 Permission Mode。
- **续跑调度（goal driver）**：挂在 Session run 层的空闲点，复用现有 run 结束后调度 asyncRewake 的位置，排在 Stop hook 判定与 rewake 之后（代码顺序保证，见 hooks 工单）。条件：空闲、未 disposing / rewinding / compacting / 切模型、无排队用户 run、goal active 且 armed。满足时 `roundsStarted + 1` 写快照，然后以 goal round 消息作为 prompt 开一个内部 run。round 消息是带 goal 来源标记的 user 消息，仅它计数；用户 prompt、Stop hook 续跑、子代理通知都不计数。下一轮之前若 `roundsStarted >= maxRounds`，转 blocked，原因为上限说明，不再开轮。
- **disarm 条件**：run 以错误、用户中止、`length`（token 超限）结束时只 disarm，phase 不变；pause / clear；resume / fork 后的初始状态。dispose 时停止调度。
- **round 消息**：照搬 DSH `renderGoalRoundPrompt` 原文（`<goal_round>`、`Objective: <JSON>`、`Round: n/max`、续做 / 自查 / 标记 complete 的指示），删去 "read the current goal" 一句（无 `get_goal`），代码注释注明来源与改动。round 消息要标记为 goal 来源，在 transcript 中可辨识，这样 frontend 能隐藏它，且回放时不当作用户 prompt：不作为 Checkpoint 锚点，不参与 Session Title fallback。
- **模型工具**（仅顶层 session 注册，Headless 也注册）：
  - `create_goal { objective: string, max_goal_rounds?: number }`：需要当前 run 里有直接人类输入（用户 prompt，或 run 中 steer 的用户消息）。语义同 `createGoal`，但不另起 run：当前 run 结束后由 driver 接手。
  - `update_goal { action: "edit"|"pause"|"resume"|"complete"|"blocked", objective?: string, blocked_reason?: string }`：edit / pause / resume 需直接人类输入；模型 resume 一个 paused 的 goal 时拒绝；complete / blocked 在直接人类输入或当前 goal round 内均可；`objective` 仅 edit 有效，`blocked_reason` 仅 blocked 且必填，参数组合错误返回工具错误。run 中用户已 pause 后模型 complete：允许，complete 覆盖 paused。
  - goal round 内 complete / blocked 成功后，追加一条收尾 user 消息（照搬 DSH `renderWrapupContext` 原文，`<goal_complete>` / `<goal_blocked>`，带 goal 来源标记），模型在同一 run 写收尾说明。complete / blocked 都会 disarm。
  - 两个工具的结果为紧凑 JSON：`{ goal: { objective, phase, roundsStarted, maxRounds, blockedReason? } | null, armed }`。
  - 工具 description 承载使用规范（照 DSH guidance 改写：从直接人类请求推断长任务意图；resume 后需人类要求才 resume；仅在确有证据时 complete；blocked 必须写具体条件）。不改 System Prompt。
  - 工具名沿用 Codex / DSH（CC 无同名工具），不提供 `get_goal`。
- **reminder**：`goal` Tool State 提供 reminder 渲染，内容为 objective、phase、`round n/max`，blocked 时附原因。goal 存在且非 complete 时注入，tombstone 或 complete 时为 undefined。走现有去重（每 run 开始、内容变了才注入）与 compaction 后立即重注入（地基 B），以此保证 compaction 后 objective 仍可见。round 推进会改变内容，因此每轮会注入一次，这个开销可接受。
- **事件**：只用现有 `tool_state_changed { name: "goal", value }` 与 run 结束事件；不新增 `goal_activation_changed`。frontend 收到其一即重读 `session.goal`（含 `armed`）。
- **子代理**：子 session 不注册 goal 工具、不挂 driver、不注入 goal reminder。
- **TUI `/goal`**（④ chat 屏解析，替换 Slash Command spec 中的占位）：文法照 DSH：`/goal`、`/goal <objective>`、`/goal edit <objective>`、`/goal pause|resume|clear`（控制字不区分大小写；其他任意文本视为 objective）。run 中可用：查看、pause、clear；其余提示"仅空闲可用"。Session API 抛的错渲染为 error notice。查看输出 notice，内容为 Status、Blocker（blocked 时）、Objective、Rounds、Activation，以及按状态给出的命令提示（照 DSH `commandHint`）。补全菜单带参数提示 `[<objective>|edit <objective>|pause|resume|clear]`。
- **TUI 面板**（③ `goal-todo-panel` 补根行，props only：`goal`、todo、`working`、`collapsed`、`onToggle`）：复刻 dsh-TUI `GoalTodoPanel`：
  - 根行 `🎯 `（suggestion 色）+ bold truncate 的 objective，右侧 PhaseBadge `<label> · n/max · <elapsed>`。label 为 `● active` / `⏸ paused` / `⛔ blocked` / `✓ complete`，颜色依次为 success / warning / error / dim。
  - elapsed 由组件本地计时：goal id 首次渲染时开始，非 complete 每秒刷新，complete 冻结。格式 `47s` / `3m12s`。
  - blocked 时下一行 `│ <reason>`（error 色，truncate）。每行固定单行高度。
  - todo 区块挂在根行下；goal 存在时 todo 区块常显（dsh `showTodoSection` 条件加入 goal 存在）；goal 与 todo 都没有时整块隐藏。
- **TUI statusline**：chip 排在最前，`<glyph> n/max`，glyph 为 `●` / `⏸` / `⛔` / `✓`，按 phase 着色，complete 为 dim。无 goal 不显示。不做 `statusBar.goal` 开关。
- **TUI 工具卡**：`create_goal` / `update_goal` 从工具结果渲染三行：`🎯 objective`、`<label> · n/max · armed|disarmed`，blocked 时再加 `⛔ reason`。工具出错时按现有错误卡呈现。
- **TUI 对话流**：带 goal 来源标记的消息（round 与收尾）不渲染为用户气泡，live 与回放一致；assistant 回答照常显示。
- **TUI i18n**：所有新文案进 TUI 应用字典（中英）；phase 标签、glyph、`🎯` 不翻译。
- **Headless CLI**：
  - 新 flag `--goal <objective>`、`--max-goal-rounds <N>`（仅与 `--goal` 同用，正整数）。`--goal` 与 `-p` 互斥，二者都缺时沿用现有报错。
  - 流程：建立或 resume session → `createGoal` → `waitForIdle`，直到 goal 不再 armed。
  - 退出码：complete 为 0；blocked（含超限）为 1；run 出错沿用现有错误退出码；用户 SIGINT 沿用现有行为。
  - `--resume <id> --goal`：已有非 complete goal 时报错，提示用 TUI 处理，不运行。
  - text 输出逐轮打印 assistant 回答；stream-json 原样输出事件，`tool_state_changed` 已覆盖，不新增类型。
  - Headless 无交互回调，按地基 A 取安全默认值。

## Testing Decisions

- **好测试**：只测外部行为。观察对象包括 Session API 返回值与 `session.goal`、fake model 收到的请求（round 消息、reminder、收尾指令）、`onEvent` / `subscribe` 事件、resume 后的状态、TUI 屏幕输出、CLI 退出码与 stdout。不测 `goal/` 内部函数、快照 parse 细节或组件内部状态。
- **三个测试入口，均为现有入口，不新增**：
  1. **Agent Core e2e**（`bun:test`，`packages/agent/tests/e2e/goal.test.ts`），用 `createSession` + `fakeModel` + `tempDirs`。覆盖：
     - `createGoal` 空闲时立即开第 1 轮；fake model 依次收到 round 1、2、3 消息；`roundsStarted` 递增并发出 `tool_state_changed`。
     - 模型在 round 内调 `update_goal complete`：收到收尾指令，写完收尾后停止，phase 为 complete，不再开轮。blocked 同理，`blockedReason` 被记录。
     - 上限：`maxRounds: 2` 时跑完 2 轮转 blocked，不开第 3 轮。
     - run 出错、`interruptRun`、`length` 结束时只 disarm，phase 仍为 active；`resumeGoal` 后继续，计数延续。
     - `pauseGoal` 在 run 中调用：当前 run 正常结束，不开下一轮；`clearGoal` 同理，且 `goal` 变为 undefined。
     - 授权：无直接人类输入的 goal round 内 `create_goal` / `update_goal edit|pause|resume` 被拒绝；用户 prompt 中可用；模型 resume paused goal 被拒绝；pause 后模型 complete 被接受。
     - 参数组合错误（edit 不带 objective、blocked 不带 reason、complete 带 reason）返回工具错误。
     - 空闲限制：run 中 `createGoal` / `editGoal` / `resumeGoal` 抛错；已有未完成 goal 时 `createGoal` 抛错；complete 后 `editGoal` 等同新建，`roundsStarted` 归零。
     - 用户在 armed 期间自发 run：结束后续跑照常，`roundsStarted` 不因用户 run 增加。
     - Stop hook block 续跑先于 goal：hook 续跑完成后才出现 round 消息，且不计数（参考 `stop-hook.test.ts`）。
     - 父 run 在子代理全部结束后才开下一轮（参考 `subagents.test.ts`）。
     - reminder：每轮请求里有 goal reminder，内容含 objective 与 `round n/max`；complete 后不再注入；compaction（手动 `compact()` 或小 `contextWindow`）后下一次请求立即含 goal reminder。
     - resume：重新 `createSession` 后 `goal` 状态一致、`armed === false`、不自动开轮；`resumeGoal` 后开轮。rewind 到 goal 创建前的 prompt 后 `goal` 为 undefined。
     - 坏快照被跳过并告警，退回上一条。
     - 子 session 中没有 goal 工具。
     - Permission Mode `ask` 下 `createGoal` 发出告警。
  2. **TUI**（`bun:test`，`apps/neant-tui/tests/screens/chat/goal.test.ts`），用 `tests/helpers/app.ts` 的 `start()` + `controlledModel` + 假终端。覆盖：
     - `/goal <objective>` 后面板出现 `🎯 objective` 与 `● active · 1/256`，statusline 出现 `● 1/256`。
     - round 消息不出现为用户气泡，assistant 回答照常出现。
     - `/goal` 查看的 notice 内容与命令提示。
     - run 中 `/goal pause` 生效且 run 未被打断，之后 badge 显示 `⏸ paused`；run 中 `/goal edit x` 显示"仅空闲可用"。
     - blocked 时出现 `│ <reason>` 行与 `⛔` chip。
     - goal 存在时，即使 todo 全部完成且空闲，todo 区块仍显示。
     - 工具卡渲染三行而非 JSON。
     - resume 带 goal 的 session 后面板与 chip 立即显示，且不自动开轮。
     - 补全菜单中 `/goal` 带参数提示。
  3. **Headless CLI**（`bun:test`，追加到 `apps/neant-cli/tests/e2e/cli.test.ts`）。覆盖：
     - `--goal` 跑到 complete 时退出码 0；blocked 和超限（`--max-goal-rounds 1`）时退出码 1。
     - `--goal` 与 `-p` 同用报错。
     - `--max-goal-rounds` 不带 `--goal`，或不是正整数时报错。
     - `--resume <id> --goal` 遇到未完成 goal 时报错、不运行。
     - stream-json 中出现 `tool_state_changed` / `goal`。
- **测试工具**：fake model 需要能脚本化 `update_goal` 工具调用（现有 fake model 已支持脚本化 tool call，按需扩展）。计时器断言用可注入时钟或只断言格式，不 sleep。
- **参考先例**：
  - Agent Core：`tests/e2e/todo.test.ts`、`todo-reminders.test.ts`（Tool State 与 reminder 及 compaction 重注入）、`plan-mode.test.ts`（Tool State resume）、`async-hooks.test.ts`（asyncRewake 内部 run）、`stop-hook.test.ts`、`checkpoint.test.ts`（rewind）。
  - TUI：`tests/screens/chat/slash-commands.test.ts`、`activity.test.ts`、`resume-picker.test.ts`。
  - CLI：`tests/e2e/cli.test.ts` 现有 flag 与退出码用例。

## Out of Scope

- `get_goal` 工具、revision / CAS（DSH 有，Neant 不做）。
- "连续 N 轮才能 blocked" 门槛（DSH `blockedAfterConsecutiveRounds`）。
- `goal_activation_changed` 事件；将来若出现不伴随 Tool State 变化或 run 结束的 armed 变化再加。
- 子代理 goal。
- `goal.maxRounds` settings 键与 `statusBar.goal` 显示开关（`/settings` 仍是占位）。
- `/goal` 附带附件（DSH 支持 attachments，Neant 暂无图片输入，见图片输入工单）。
- 自动提升 Permission Mode。
- Headless 下处理已有未完成 goal（edit / resume / clear），交给 TUI 处理。
- 多 goal、goal 历史列表。

## Further Notes

- round 与收尾提示词原文出自 deepseek-harness `goal-round-driver/src/prompt.ts` 与 `tool-goal/src/wrapup.ts`。实现时保留原英文文本，删掉的句子在注释中注明。
- `CONTEXT.md` 的 Goal 定义无需修改。
- 依赖的地基都已在 main 上：Tool State、reminder 与 compaction 重注入、Stop hook、asyncRewake 调度、`GoalTodoPanel` 骨架、Slash Command 框架。
