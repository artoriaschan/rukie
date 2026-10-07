Status: resolved

# Spec: todo 工具（`todo_write`）与 Tool State 地基

来源：[todo 工具](../agent-core-roadmap/issues/07-todo.md)；基于 [地基 B：工具状态进 transcript](../agent-core-roadmap/issues/02-tool-state-in-transcript.md)。

## Problem Statement

多步任务里，模型没有地方记"要做哪几步、做到哪了"。计划只散落在回复文本里：用户看不到整体进度，只能翻 transcript 猜；模型在长 run、compaction 或 resume 之后容易忘掉还剩什么，漏步或重复做。Neant 也还没有任何机制让工具状态跨 run / resume 存活，后续 Goal、后台 bash、checkpoint 都卡在这一点上。

## Solution

Agent Core 提供模型工具 `todo_write`：模型每次写入完整的 Todo List（每项内容 + 待办 / 进行中 / 已完成）。清单作为 Tool State 记进 transcript，resume 后原样恢复；还有未完成项时，经 system reminder 告知模型，compaction 后立即重新告知。TUI 在输入框上方显示待办面板（复刻 dsh-TUI `GoalTodoPanel` 的 todo 部分），可用 `ctrl+q` 或鼠标折叠；transcript 里的工具调用显示成一行进度摘要。Headless CLI 的 stream-json 自动带上状态变化事件。

为此先落地地基 B 的最小实现：通用 Tool State 模块（快照写入、回放、坏记录跳过、变化事件、compaction 后重注入），todo 是它的第一个使用者。

## User Stories

1. 作为模型，我想用一次 `todo_write` 调用写下完整任务清单，以便在动手前把多步工作拆开。
2. 作为模型，我想每次更新都提交整张清单，以便不用记条目 id，也不用拼增量。
3. 作为模型，我想把某项标为 `in_progress`，以便表明正在做哪一步。
4. 作为模型，我想在并行推进时把多项同时标为 `in_progress`，以便如实反映进度。
5. 作为模型，我想做完一步立刻把它标为 `completed`，以便清单始终反映真实进度。
6. 作为模型，我想通过从清单里删掉某项来取消它，以便不需要额外的"已取消"状态。
7. 作为模型，我想写入空数组来清空清单，以便任务结束或计划作废时收尾。
8. 作为模型，我想在写入后收到一行计数结果，以便确认写入成功又不浪费 context。
9. 作为模型，我想在提交空内容或重复内容时收到明确的工具错误，以便改正后重试。
10. 作为模型，我想在新 run 开始、清单还有未完成项时，通过 system reminder 看到当前清单，以便接着上次的进度做。
11. 作为模型，我想在 compaction 之后立刻重新看到当前清单，以便摘要丢掉细节后也不忘还剩什么。
12. 作为模型，我想在 session resume 后仍能看到 resume 前的清单，以便跨进程继续工作。
13. 作为模型，我想在清单全部完成或为空时不再收到 todo reminder，以便不被无用上下文打扰。
14. 作为 TUI 用户，我想在输入框上方看到待办面板，以便随时知道 agent 的计划和进度。
15. 作为 TUI 用户，我想用 `●` / `✓` / `○` 区分进行中、已完成、待办，以便一眼看出状态。
16. 作为 TUI 用户，我想看到已完成项整行变暗，以便视线集中在剩下的工作上。
17. 作为 TUI 用户，我想看到折叠头上的 `✓ done/total` 计数，以便知道总体完成度。
18. 作为 TUI 用户，我想让条目以树形挂在折叠头下（`├─` / `└─`），以便面板和后续 Goal 根行保持统一结构。
19. 作为 TUI 用户，我想在清单超过 8 项时看到 `… N more`，以便面板不挤占对话区。
20. 作为 TUI 用户，我想让超长条目截断为一行，以便面板高度可预期。
21. 作为 TUI 用户，我想在 agent 运行中看到全部条目，以便跟随进度。
22. 作为 TUI 用户，我想在空闲时只看到未完成条目，以便面板只提示还剩什么。
23. 作为 TUI 用户，我想在空闲且没有未完成项时面板自动消失，以便不占空间。
24. 作为 TUI 用户，我想按 `ctrl+q` 折叠 / 展开面板（运行中也行），以便在需要更多对话空间时收起。
25. 作为 TUI 用户，我想点击折叠头来折叠 / 展开，悬停时有背景反馈，以便用鼠标操作。
26. 作为 TUI 用户，我想在折叠状态下仍看到一项预览（优先进行中项，否则第一个未完成项），以便收起后也知道当前在做什么。
27. 作为 TUI 用户，我想在展开时看到"Ctrl+Q 折叠"提示，以便发现快捷键。
28. 作为 TUI 用户，我想让审批框出现时盖住面板；提问框则与 todo 同时显示，以便回答时也能看到计划。
29. 作为 TUI 用户，我想看到 transcript 里的 `todo_write` 调用显示为"待办清单"加 `todos ✓ done/total` 和进行中项（最多 4 行），以便回看历史时知道当时的进度，而不是看原始 JSON。
30. 作为 TUI 用户，我想在 resume 一个旧 session 后立刻看到它的待办面板，以便接着上次的工作。
31. 作为中文 / 英文用户，我想让面板与工具卡的所有文案按我的 locale 显示，以便界面语言一致。
32. 作为 Headless CLI 用户，我想在 stream-json 输出里收到 `tool_state_changed` 事件，以便脚本跟踪 todo 进度。
33. 作为 Headless CLI 用户，我想在 text 输出模式下只看到最终文本，以便现有脚本不受影响。
34. 作为 frontend 开发者，我想通过 `tool_state_changed { name, value }` 事件和 `session.toolState(name)` 读取 Tool State，以便不用理解存储格式。
35. 作为维护者，我想在 transcript 里有坏的 Tool State 记录时，session 仍能 resume，跳过坏记录、退回上一条有效快照，并收到警告，以便单条损坏不让整个 session 打不开。
36. 作为维护者，我想让每种 Tool State 自带版本号和 parse 校验，以便以后改 schema 时能识别旧记录。
37. 作为 Agent Core 后续能力（Goal、后台 bash、checkpoint）的开发者，我想复用同一套 Tool State 模块，以便不用各自重造持久化与重注入。
38. 作为子代理的使用者，我想让子代理的 Todo List 记在它自己的 transcript，不影响父 session 的清单，以便父子进度互不干扰。

## Implementation Decisions

### Tool State 地基（Agent Core 新模块 `tool-state`，按 `CONTEXT.md` 一概念一目录）

- **记录格式**：pi `custom` entry，`customType: "tool-state/<name>"`，`data: { version: number, value: JsonValue }`，与模型消息同在 `main` 分支按序穿插。写入沿用 Neant 现有 branch 写入模式（单次 mutate 内 insert entry 并推进 branch tip）。
- **定义**：每种 Tool State 提供 `name`、当前 `version`、`parse(version, value)`（版本 + schema 校验，失败即视为坏记录）、可选的 reminder 渲染（当前值 → 文本或 undefined）。
- **回放**：resume / 构建 Session 时按序扫描，每个 name 取最后一条 parse 成功的快照（last-wins）。parse 失败的记录跳过，退回上一条有效快照，经现有 `onWarning` 告警；session 照常 resume。
- **写入**：工具（或 Agent Core 内部）调用"设置 Tool State"时追加一条完整快照，更新内存当前值，发出 `tool_state_changed`。
- **事件**：`@neant/shared` 的 `CustomSessionEvent` 新增 `{ type: "tool_state_changed"; name: string; value: unknown }`，值为解析后的当前值（不含 version）。现有约定允许 SessionEvent 破坏性变更，但这里只是新增。
- **读取 API**：`Session.toolState(name)` 返回当前值（无记录时 undefined），供 frontend resume 后首次渲染。
- **反馈给模型**：每个带 reminder 渲染的 Tool State 自动注册为一个 `ReminderSource`（source 即 name），走现有去重：每 run 开始、内容变了才注入。
- **compaction 后**：compaction 结束时立即把所有 Tool State 的当前 reminder（非 undefined 者）作为 system reminder 追加到摘要之后并写入 transcript，当前 run 后续 turn 即可见。Tool State reminder 的去重比较只看最后一次 compaction 之后的消息。现有 skills / mcp reminder 的同类缺陷不在本 spec 修。
- **子代理**：本 spec 不实现子代理；Tool State 天然按 session 隔离即满足地基 B 第 9 条。

### `todo_write` 工具（Agent Core 内置工具）

- 名称 `todo_write`，默认启用（Headless CLI 与 TUI 都有），不走审批（与 `ask_user_question` 同为无副作用工具）。
- 参数：`{ todos: Array<{ content: string; status: "pending" | "in_progress" | "completed" }> }`，条目不允许额外字段。
- 校验：content trim 后非空、彼此不重复；违反时工具抛错（模型看到错误结果）。不限制 `in_progress` 个数。存入的是 trim 后的值。
- 执行：把规范化后的整张清单写为 Tool State `todo`（version 1）；空数组合法，即清空。
- 结果：纯文本一行 `Updated todo list: N pending, N in progress, N completed.`
- description：照 deepseek-harness `tool-todo` 的并行版文案（多步任务才用、动手前每步一项、进行中项保持 `in_progress`、仅并行时多个、做完立即 `completed`），注明来源。
- Tool State `todo`：值为 `TodoItem[]`；parse 校验数组 / 字段 / 状态枚举，不校验 `in_progress` 个数（与上游 invariant 一致，避免历史记录因策略变化失效）。
- reminder 渲染：清单非空且有未完成项时，渲染为带状态标记的清单文本（每行一项，附上"按需更新"的一句提示）；否则 undefined。不做"N 轮未更新"催促。
- 生命周期：值一直保留到下次写入；Agent Core 不按 run 或"全部完成"自动清空。

### TUI（`apps/neant-tui`）

- **app 组件区 `goal-todo-panel`**（③ 层，props only）：输入 todo 列表、`working`、`collapsed`、`onToggle`；为 Goal 留根行结构（本 spec 不渲染 Goal）。
  - 树形：根为折叠头 `▾`/`▸` + `✓ done/total`（按全量计数）；条目前缀 dim `├─ `，末行 `└─ `。
  - 图标：`●` in_progress（强调色）、`✓` completed（dim）、`○` pending（dim）；completed 整行 dim，无删除线。每行固定 1 行高、截断；按模型写入顺序。
  - 最多 8 条可见，余下显示 `└─ … N more`。
  - 显隐：运行中显示全部；空闲时隐藏已完成项（计数仍全量）；空闲且无未完成项、或列表为空时整块不渲染。
  - 折叠时只剩头部一行 + 一项预览（优先 in_progress，否则首个未完成）。展开时底部提示"Ctrl+Q 折叠"。
  - 折叠头可点击切换，悬停换背景（复用 renderer 现有 hover 能力）。
- **chat 屏（④ 层）**：
  - 状态来源：订阅 `tool_state_changed`（name 为 `todo`），resume / 启动时用 `session.toolState("todo")` 初始化。
  - 位置：底部区域、输入框上方，activity-line 之后、notice 之前；审批框出现时不渲染面板；提问框与 todo 共存，并由 chat 屏统一分配底部高度（2026-10-04 用户修正，见 [提问面板规格](../question-panel/spec.md)）。
  - `ctrl+q` 切换折叠（运行中也有效）；折叠状态为屏幕本地状态，默认展开，不持久化。
- **transcript 工具卡**：`todo_write` 显示工具名"待办清单"（en: `TodoWrite`），摘要 `todos ✓ done/total`，其后每个 in_progress 项一行 `● content`，整卡最多 4 行；从该次工具调用的参数渲染，不读 Tool State；工具出错时按现有错误卡呈现。不做前后快照 diff。
- **i18n**：所有新文案（工具名、`… N more`、`todos ✓`、折叠提示）进 TUI 应用字典，中英两份。

### Headless CLI

- 无代码改动：stream-json 原样转发 `tool_state_changed`；text 模式不输出 todo。

## Testing Decisions

- **好测试**：只测外部行为，即模型下一轮 context 里的内容（toolResult 文本、todo system reminder）、`onEvent` 收到的事件、`session.toolState(...)` 的返回值、TUI 屏幕输出；不测 `tool-state` 内部函数、回放循环或组件内部状态。
- **Seam 1：Agent Core 黑盒**，即 `createSession` + fake model（`tests/helpers/fake-model.ts`、`temp-dirs.ts`），放在 `packages/agent/tests/e2e/`。覆盖：
  - `todo_write` 成功写入后的计数结果文本；空内容 / 重复内容的工具错误；`[]` 清空。
  - `tool_state_changed { name: "todo", value }` 事件与 `session.toolState("todo")`。
  - 下一个 run 开始时有未完成项即注入 todo reminder；全部完成或为空时不注入；内容未变时不重复注入。
  - resume：新建 Session 读回同一 session 后 `toolState("todo")` 与 reminder 都恢复。
  - 坏记录：直接往 session JSONL 追加一条 parse 失败的 `tool-state/todo` 记录后 resume，结果退回上一条有效快照并触发 `onWarning`。
  - compaction：触发 compaction 后，同一 run 的下一 turn context 中摘要之后紧跟 todo reminder。
  - Prior art：`tests/e2e/reminders.test.ts`（reminder 注入与去重）、`compaction.test.ts`（触发 compaction）、`questions.test.ts`（内置工具黑盒）、`run.test.ts`（resume）。
- **Seam 2：TUI 黑盒**，即 `apps/neant-tui/tests/helpers/app` 的 `start` + faux 模型，放在 `apps/neant-tui/tests/e2e/`。覆盖：
  - 面板树形、图标、计数、8 条上限与 `… N more`、运行中 / 空闲显隐、全部完成后消失。
  - `ctrl+q` 折叠 / 展开与折叠预览；鼠标点击折叠头切换。
  - 审批框出现时面板不显示；提问框出现时 todo 仍显示。
  - resume 后面板立即出现。
  - transcript 工具卡摘要与 4 行上限。
  - 中英文案（同时受 `hardcoded-han` 检查约束）。
  - Prior art：`tests/e2e/question-summary.test.ts`（工具卡摘要 + locale）、`questions.test.ts` / `permissions.test.ts`（底部槽位交互）、`resume.test.ts`、`status-line.test.ts`。
- Headless CLI 不单独测：stream-json 原样转发事件，seam 1 的事件断言已覆盖。

## Out of Scope

- Claude Code V2 的 `TaskCreate/Get/List/Update` 与任何多 agent 共享任务表（id、owner、依赖、锁）。
- 条目 `activeForm`、id、priority、`cancelled` 状态。
- "N 轮未更新 todo"的催促 reminder；完成后的 verification 提示。
- Goal 根行、`goal 存在` 时 todo 区块常显条件、状态栏 goal chip（归 Goal 工单）。
- 前后快照 diff（新增 / 更新 / 移除）、轨迹视图、`/settings` 改键。
- Headless CLI text 模式下的 todo 输出或 flag。
- 修复现有 skills / mcp reminder 在 compaction 后不重发的缺陷（已记入路线图 fog）。
- 子代理本身。

## Further Notes

- 参考实现：deepseek-harness `packages/todo/tool-todo`（工具、description、invariant）及其 Agent Note `.agents/notes/archived/feature/2026-06-29-todo-write-tool.md`；dsh-TUI `src/components/GoalTodoPanel.tsx`（面板）、`src/dsh-adapter/channel/transcript.ts`（工具卡）、`src/utils/keymap.ts`（`ctrl+q`）。
- 与上游的差异：不按 turn 清空清单（上游投影在下一个 `turn/start` 置空）；坏记录跳过而非整体报错；无 `allowParallelInProgress` 配置（固定允许并行）。
- 建议切片顺序：① Tool State 地基（无工具使用者时用 seam 1 的 todo 用例驱动，可与 ② 同片）→ ② `todo_write` + reminder + compaction 重注入 → ③ TUI 面板与折叠交互 → ④ transcript 工具卡。
- Goal 工单会在同一面板上加根行；面板组件命名与 props 应为此留余地，但不要提前实现。

## Completion

2026-10-04：按 01 → 05 顺序逐个交给子代理，均使用 `implement` skill、公共 seam 的 TDD 与独立 Standards / Spec 双轴审查。五个 [issue](issues/) 已全部勾选并标记 `done`，实现和各项验收证据已提交到 `main`。

- Tool State、`todo_write`、resume 与坏记录告警：[01](issues/01-todo-write-and-resume.md)。
- Run reminder 去重与 compaction 后同 Run 重注入：[02](issues/02-todo-reminder-and-compaction.md)。
- 树形面板、状态显隐、对话框遮挡与短终端布局：[03](issues/03-tui-todo-panel.md)。
- Ctrl+Q、鼠标点击 / hover、预览与本地折叠状态：[04](issues/04-tui-panel-fold.md)。
- 双语四行工具卡、各次历史独立、resume 和错误卡：[05](issues/05-transcript-todo-card.md)。

最终完整验收 `rtk proxy env -u NO_COLOR caffeinate -is bun run check`：exit 0；format / lint / typecheck / Knip 均通过，715 pass / 0 fail，4431 assertions，60 files，100.27 秒。完整输出保存于 `/tmp/neant-todo-issue05-final-check.log`；审查合计无未解决问题。主代理逐项核对当前源实现、四个 todo 公共行为测试文件、完整验收输出和五份 issue 的完成证据。
