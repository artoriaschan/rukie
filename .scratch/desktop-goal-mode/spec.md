Status: claimed

# Spec: 桌面与 Web 目标模式

来源：rukie.pen 的 C09 中「目标模式」行，以及 M03-C（目标模式的唯一维护源，包含 C37、C38、C42 和 H17、H17-H、H18、H18-P 流程帧及其浅色版）。依赖已完成的 [Goal](../goal/spec.md)（Agent Core、TUI、headless）和 [新聊天选择条](../new-chat-selector/spec.md)（C32 的几何）。术语见 `CONTEXT.md` 中的 Goal、Tool State、Run、Turn、Permission Mode。

## Problem Statement

Agent Core、TUI 和 headless 都已支持 Goal，但桌面和 Web 还没有入口。C09 Plus 菜单只实现了「添加文件或文件夹」。wire 协议里没有 Goal 命令。UI 虽然通过 `toolStates.goal` 拿到了 Goal 状态，但没有渲染。用户在桌面端无法让 agent 一直做到目标完成，也看不到 Goal 的状态，无法暂停、继续或删除它。

现有的 `createGoal` 只接受文本，第一轮输入是隐藏的 `<goal_round>` 提示，所以用户写的目标不会出现在对话里，也无法附带图片。Goal 状态也不记录时间，C38 需要的「已执行时间」在刷新或恢复后无法保持。

## Solution

- 在 C09 Plus 菜单中把「目标模式」做成一个开关。当前权限不是完全访问时，先弹出 C42。确认后，系统把权限切换为完全访问，并开启目标模式。
- 开启后，C04 底栏在权限模式右侧显示 C37。用户这时发送的内容（文字、图片，或两者都有）即为目标。这条消息作为可见的用户消息写入对话，并启动自动推进。
- 推进过程中，输入框上方显示 C38。C38 包括状态、首条消息和已执行时间，右侧有删除按钮和暂停/继续按钮。
- Agent Core 持久化已执行时间。Goal 的创建入口只保留一个，它接受图片，并允许只发图片的目标。

## User Stories

1. 作为用户，我想在新聊天或空闲的已有会话中，通过「＋」→「目标模式」开启目标模式，让 agent 一直做到完成或受阻。
2. 作为用户，当前权限不是完全访问时开启目标模式，我希望先看到风险说明。确认后自动切换为完全访问，取消则什么都不变。
3. 作为用户，我希望开启后在权限模式右侧看到「目标」标识。悬停或聚焦时它变成 ×，点击即可取消开启，已经输入的内容保留。
4. 作为用户，我希望再点一次 C09 的「目标模式」行也能关闭它。
5. 作为用户，Run 进行中或已有未完成目标时，我希望「目标模式」行不可选，并看到原因。
6. 作为用户，我希望目标可以带图片，也可以只发图片。
7. 作为用户，我希望发出的目标以普通用户消息的形式出现在对话里。
8. 作为用户，我希望推进中能在输入框上方看到「进行中」、首条消息和不断增长的已执行时间。
9. 作为用户，我希望暂停后当前这一轮跑完就不再推进，时间冻结。继续后时间接着累加。
10. 作为用户，暂停期间我仍然可以发消息补充说明，这不会自动恢复推进。
11. 作为用户，我希望删除目标后状态条和「目标」标识立即消失，已有的对话和文件改动都保留。
12. 作为用户，我点了停止，或者 Run 出错中断后，希望看到「已暂停」，并且可以继续。
13. 作为用户，目标受阻时，我希望看到「已受阻」，在 tooltip 中查看原因，并且可以点继续。
14. 作为用户，轮次用尽时，我希望看到「已达上限」，继续按钮不可用，但仍然可以删除。
15. 作为用户，目标完成后，我希望状态条自动消失，结果在对话里由 agent 总结。
16. 作为用户，刷新页面、重开会话或从另一个窗口打开时，我希望已执行时间和状态保持一致。
17. 作为用户，切换会话或新聊天草稿时，我希望「已开启目标模式」跟着各自的草稿走。
18. 作为键盘用户，我希望 C09 行、C37、C38 的按钮和 C42 都可以用 Tab、Enter、Space、Escape 操作，并且都有可访问名称。
19. 作为 TUI 或 headless 用户，我希望 `/goal <目标>` 和 `--goal` 设定的目标也作为一条用户消息出现在对话里。

## Implementation Decisions

### Agent Core

- `createGoal(objective, { images?, maxRounds? })` 在同一个请求中完成两件事：把目标文本和图片作为一条人类来源的用户消息写入对话，然后创建 Goal 并启动推进。这条消息就是第 1 轮的模型输入，计入 `roundsStarted`，第 2 轮起仍使用 `<goal_round>`。图片沿用 prompt 的 `validateImage` 和体积限制，不写入 Tool State。只有这一个创建入口，不提供「先发 prompt 再创建」的路径。
- `objective` 可以为空，但文本和图片至少要有一项。Goal Tool State 升级到 version 2，新增以下字段：
  - `attachments`：目标消息里的图片数量。
  - `elapsedMs`：已经结算的推进时长。
  - `activeSince?`：本段推进的开始时刻，只在推进中存在。
  - 不迁移 version 1，按仓库「不保留向后兼容」的约定处理。
- `objective` 为空时，`<goal_round>` 和 Goal reminder 不写空字符串，而是说明目标在第一条目标消息的附件中，并给出附件数量。这项改动要按 [ADR-0046](../../docs/adr/0046-system-prompt-sections-and-reminder-roles.md) 同步模型指引。
- 已执行时间按墙钟时间累计，覆盖整个推进期间，包括等待权限确认和 `ask_user_question` 的时间。以下时刻结算本段：暂停、受阻、停止、出错、完成、清除、轮次用尽，以及每一轮结束。结算方式是把 `activeSince` 到当前的时长加进 `elapsedMs`；推进继续时设新的 `activeSince`，否则清空。Session 恢复时，如果推进没有继续，就丢弃未结算的这一段，停机时间不计入。Fork 复制 `elapsedMs`，清空 `activeSince`。Rewind 恢复当时的值。
- 只有在 armed 为 true 时才存在 `activeSince`，Session 接口不另加「是否推进中」的字段。达到上限由 `roundsStarted >= maxRounds` 判断。
- 权限模式不是完全访问时，`warn` 的文案改为建议使用完全访问。
- 模型工具 `create_goal` 不接收图片，行为不变。

### wire 与 server

- `session.create` 新增可选字段 `goal: true`。这时调用 `createGoal(text, { images })`，不调用 prompt。只有 `goal: true` 时，`text` 才允许为空；文本为空时 `images` 至少一项。
- 新增 Session 级命令，命名沿用 `session.set_permission_mode`：
  - `session.goal_create { sessionId, text, images? }`
  - `session.goal_pause { sessionId }`
  - `session.goal_resume { sessionId }`
  - `session.goal_clear { sessionId }`
- 状态继续通过已经转发的 `toolStates.goal`（snapshot 和 `tool_state_changed`）推送，不新增事件。
- `goal-exists`、`goal-busy`、`goal-complete`、`goal-round-limit`、`goal-pause-invalid` 等 UserVisibleError 沿用现有的错误回传方式，客户端错误码白名单要补上这些。

### UI

- C09「目标模式」行：
  - 点击切换开关。
  - 开启时，如果当前权限不是完全访问，先弹出 C42。
  - Run 进行中，或已有 phase 不为 complete 的 Goal 时，这一行禁用，描述改为原因。
  - 开启后焦点回到输入框。
- C42 基于 MorphingModal，几何和 C36 一致。只有两个按钮：「取消」（初始焦点）和使用全局 `destructive` 的「切换到完全访问并开启」。确认时先发 `session.set_permission_mode`（新聊天时写入草稿的 permissionMode），再开启目标模式。取消、Esc 或点击遮罩都不开启。之后用户改权限不再拦截，发送时也不会再弹。
- 「已开启目标模式」作为 `InputDraft` 的字段，跟随会话或新聊天草稿。发送成功后清除，发送失败则保留。
- C37 在开启后、发送前显示于 C04 权限模式右侧。悬停或聚焦时显示 ×，点击、Enter 或 Space 取消开启。输入提示改为「输入目标内容，发送后自动持续推进，直到完成或受阻」。
- 开启后发送：
  - 新聊天发 `session.create { goal: true }`，已有会话发 `session.goal_create`。
  - 可以只发图片。
  - 新聊天时，会话创建成功后 C32 消失，然后 C38 出现。
- C38 的几何和 C32 相同：同宽、40px 高、`surface` 背景、上方 12px 圆角、背景向下延伸 16px 到输入框圆角后方。只在存在 phase 不为 complete 的 Goal 时显示。状态映射见下表。
- 首条消息取 `objective`，单行显示，超出部分省略，完整内容放进 tooltip 和可访问名称。`objective` 为空时显示「图片目标 · N 张图片」。时间根据 `elapsedMs + (now - activeSince)` 每秒刷新。
- 删除调用 `session.goal_clear`，没有确认弹窗，也不中止当前这一轮。暂停调用 `session.goal_pause`，继续调用 `session.goal_resume`。
- Goal 推进中，Run 进行时的输入提示为「要求后续变更」，这时发出的消息走现有的 steer 或 followUp 路径。暂停时输入提示为「补充说明后继续，或点击继续恢复推进」，发出的消息是普通 prompt。
- UI 不提供目标编辑，也不提供 maxRounds 设置。
- 所有新增文案同时写入 zh 和 en 词典。DESIGN.md 新增「M03-C 目标模式」一节，覆盖 C37、C38、C42 的几何、状态、颜色和交互约束。

| Goal 事实                                | C38 状态               | 图标                        | 操作                     |
| ---------------------------------------- | ---------------------- | --------------------------- | ------------------------ |
| `active` 且 armed                        | 进行中，时间刷新       | `target`                    | 删除、暂停               |
| `paused`，或 `active` 但未 armed         | 已暂停，时间冻结       | `target`                    | 删除、继续               |
| `blocked`                                | 已受阻，原因在 tooltip | `circle-alert`（`warning`） | 删除、继续               |
| 未 armed 且 `roundsStarted >= maxRounds` | 已达上限               | `circle-alert`（`subtle`）  | 删除；继续禁用并说明原因 |
| `complete`                               | 隐藏 C38 与 C37        | —                           | —                        |

### TUI 与 headless

- `/goal <目标>` 和 `--goal` 走同一个 `createGoal`，目标会作为一条可见的用户消息出现。TUI 不新增图片入口，也不显示已执行时间。headless 的退出码语义不变。

## Testing Decisions

- Agent Core 用 `createSession` 加上 fake model 编写 e2e 测试，覆盖以下内容：
  - 带图片的目标：第 1 轮的模型输入包含文本和图片，对话里是一条人类用户消息，第 2 轮起使用 `<goal_round>`。
  - 只发图片的目标：提示和 reminder 的措辞。
  - 文本和图片都为空时拒绝。
  - 已执行时间用虚拟时钟验证：暂停、继续、受阻、停止、每轮结算、恢复时丢弃未结算的段、Fork 和 Rewind。
  - 权限提示的文案。
- server 测试覆盖：`session.create { goal: true }`、四个 goal 命令、空文本加图片的校验、错误码，以及 `toolStates.goal` 的推送。
- UI 在 Chromium 下测试：
  - C09 开关、禁用及原因。
  - C42 的初始焦点、取消、确认切换权限。
  - C37 悬停变 ×、取消开启。
  - 草稿随会话切换。
  - 新聊天和已有会话的发送命令。
  - C38 的五种状态与按钮（时间刷新用虚拟时钟）。
  - 删除后不留占位。
  - 键盘操作与可访问名称。
  - Light、Dark 与窄宽度下的几何。
- 更新 TUI 和 headless 中对 Goal 第一轮输入、对话内容的断言。
- UI 完成后做一次 agent-browser 验收。

## Out of Scope

- C09 中的其他行（引用对话、计划模式、MCP、技能、操作浏览器、操作电脑）。
- UI 中编辑目标、设置 maxRounds，以及计划模式和目标模式的组合。
- TUI 的图片目标入口和已执行时间展示。
- 新的 wire 事件，以及把 server `onWarning` 转发给 UI。

## ADR Coverage

| 决定或修改                                            | 归属                                                                              | 理由                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 目标消息作为人类来源的第 1 轮输入，允许只发图片的目标 | 更新 [ADR-0018](../../docs/adr/0018-goal-state-and-idle-scheduling.md)            | 改变「Goal 只以目标文本表达、第 1 轮为内部提示」的取舍，图片只存在于目标消息中，不进 Tool State |
| Goal 持久化已执行时间、停机时间不计入                 | 更新 [ADR-0018](../../docs/adr/0018-goal-state-and-idle-scheduling.md)            | Goal 事实新增时长，与 armed 的进程归属保持一致：未结算的段不跨进程延续                          |
| 新增 Goal wire 命令和 `session.create` 的 goal 字段   | 沿用 [ADR-0031](../../docs/adr/0031-desktop-wire-protocol-and-local-auth.md)      | 在现有的命令校验与本地认证边界内扩展命令，不改变协议结构                                        |
| 开启前确认并切换为完全访问                            | 沿用 [ADR-0014](../../docs/adr/0014-permission-rules-and-project-trust.md)        | 由用户显式选择 Permission Mode，Goal 本身不扩大权限                                             |
| Goal 提示与 reminder 的措辞                           | 沿用 [ADR-0046](../../docs/adr/0046-system-prompt-sections-and-reminder-roles.md) | 只改 Goal 自有的 reminder 内容，位置和角色不变                                                  |
| C37、C38、C42 的视觉与交互                            | 无需 ADR                                                                          | 局部样式与交互，由 DESIGN.md 和 rukie.pen M03-C 维护                                            |
