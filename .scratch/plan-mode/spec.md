Status: resolved

# Spec: Plan Mode

来源：[plan mode](../agent-core-roadmap/issues/10-plan-mode.md)；基于 [地基 A：交互通道](../agent-core-roadmap/issues/01-interaction-channel.md)、[地基 B：工具状态进 transcript](../agent-core-roadmap/issues/02-tool-state-in-transcript.md)；参考 deepseek-harness `packages/plan/plan-mode`、dsh-TUI 计划评审、Claude Code `EnterPlanMode` / `ExitPlanMode`。

## Problem Statement

用户交给 agent 一件稍大的事，agent 会立刻动手改代码。用户还不知道它打算怎么做，等改到一半发现方向不对，已经有一堆改动要回退。现在没有办法让 agent 先探索、先给出方案，等用户点头后再执行；也没有办法在方案不对时给反馈，让它改完方案再来。

## Solution

用户在 TUI 输入 `/plan`（可带一条指令）打开 Plan Mode；模型也可以在判断任务需要规划时调用 `enter_plan_mode`，经用户批准后进入。Plan Mode 下模型收到一条 system reminder，要求它先探索、再用 `exit_plan_mode` 提交一份 markdown 计划。计划出现在评审面板里，用户可以选择：

- **批准**：退出 Plan Mode，模型开始执行。
- **继续规划**：附上反馈，模型修改计划后重新提交。
- **Esc 接手**：先说话，模型停在 Plan Mode 等待下一条消息。

Plan Mode 与 Permission Mode 相互独立，只引导模型，不限制工具：工具调用照常按 Permission Rule 与 Permission Mode 判定。想要真正只读，用户自己切到 `ask` 模式。批准计划不会改变 Permission Mode。Plan Mode 状态随 transcript 持久化，resume 后保留；subagent 与父 session 共用这个状态。Headless CLI 没有评审通道，不提供 Plan Mode。

## User Stories

### 用户进入与退出

1. 作为 TUI 用户，我想输入 `/plan` 打开 Plan Mode，这样下一条 prompt 起 agent 先出方案。
2. 作为 TUI 用户，我想输入 `/plan <指令>`，在打开 Plan Mode 的同时把这条指令作为 prompt 发出，这样少一步操作。
3. 作为 TUI 用户，我想输入 `/plan off` 直接关闭 Plan Mode，这样不用等模型提交计划。
4. 作为 TUI 用户，我想在 run 进行中也能 `/plan` 或 `/plan off`，从下一次模型调用起生效，这样不必先中止 run。
5. 作为 TUI 用户，我想在已处于 Plan Mode 时再输 `/plan` 不报错，带指令时只发出指令，这样重复操作是安全的。
6. 作为 TUI 用户，我想 `Shift+Tab` 仍然只切换 Permission Mode，这样两个开关互不干扰。

### 模型进入与提交

7. 作为模型，我想在判断任务需要规划时调用 `enter_plan_mode`，这样不用等用户想起来。
8. 作为用户，我想让 `enter_plan_mode` 走审批框，由我决定是否进入，这样模型不能自己把对话拖进规划阶段。
9. 作为模型，我想在 Plan Mode 下收到明确的提示：先探索，再用 `exit_plan_mode` 提交 markdown 计划，这样我知道该怎么做。
10. 作为模型，我想用 `exit_plan_mode { plan }` 提交计划，并在工具结果里得知用户的决定，这样我知道下一步是执行还是修改。
11. 作为模型，我想在计划获批后收到一条"已退出 plan mode，可以执行"的提示，这样我知道约束解除了。
12. 作为模型，我想在用户选"继续规划"时，在失败的工具结果里看到反馈原文，这样能针对性地修改。
13. 作为模型，我想在用户按 Esc 接手时收到"用户要接手，等待下一条消息"，这样我停下来，不再追加操作。
14. 作为模型，我想在 Plan Mode 外调用 `exit_plan_mode`、或已在 Plan Mode 时调用 `enter_plan_mode` 时收到明确的报错，这样不会误以为操作成功。
15. 作为模型，我想在 Plan Mode 下仍能用全部工具（按权限判定），这样可以跑测试、读日志来支撑计划。

### 评审

16. 作为 TUI 用户，我想在评审面板里看到用 markdown 渲染的完整计划，并能滚动，这样长计划也能读完。
17. 作为 TUI 用户，我想按 `1` 批准、按 `2` 继续规划，这样一键做决定。
18. 作为 TUI 用户，我想直接打字进入反馈输入行，按 `Enter` 以"继续规划"提交，这样写反馈不用先选选项。
19. 作为 TUI 用户，我想用 ↑/↓ 在选项和反馈行之间移动，也能用鼠标点选，这样操作方式与审批框一致。
20. 作为 TUI 用户，我想在反馈输入行有内容时数字键当作普通字符，这样写反馈时不会误触批准。
21. 作为 TUI 用户，我想按 `Esc` 关闭评审先说话，模型停在 Plan Mode，这样我能补充上下文后再让它继续。
22. 作为 TUI 用户，我想在评审面板打开时 todo 面板和子代理面板仍然显示，评审面板紧贴输入框，这样批准时能看到上下文。
23. 作为 TUI 用户，我想在中止 run 时评审面板随之关闭，这样不会留下悬空的面板。
24. 作为 TUI 用户，我想让批准计划不改变 Permission Mode，这样执行阶段仍按我原来的设置走。

### 呈现与持久化

25. 作为 TUI 用户，我想在 Plan Mode 下看到输入框边框变成 plan 色、StatusLine 显示 `plan` chip，这样一眼知道当前状态。
26. 作为 TUI 用户，我想在消息流里看到获批的计划，折叠在 `exit_plan_mode` 工具卡里，可以展开，这样执行过程中能回看。
27. 作为 TUI 用户，我想在消息流里看到被要求修改的计划和我的反馈，这样能追溯方案是怎么改的。
28. 作为用户，我想 resume 一个处于 Plan Mode 的 session 后它仍处于 Plan Mode，这样中途退出不会让 agent 跳过评审直接执行。
29. 作为用户，我想让 Plan Mode 的状态变化记进 transcript，这样 rewind / fork 到某个点时状态随之回到那时。

### 权限、子代理与 Headless

30. 作为用户，我想让 Plan Mode 不改变任何工具的权限判定，这样我写下的规则和选择的 Permission Mode 始终是唯一的判定来源。
31. 作为用户，我想让子代理与父 session 共用 Plan Mode 状态并收到同样的提示，这样委派出去的调查也遵守"先规划"。
32. 作为用户，我想让子代理不能进入或提交计划，这样计划只由父代理汇总后交给我。
33. 作为 Headless CLI 用户，我不想看到 `enter_plan_mode` / `exit_plan_mode` 出现在工具集里，因为没有人能评审，这样不会因为没人评审而卡住。
34. 作为 frontend 开发者，我想通过 `session.setPlanMode(on)` 和 `session.planMode` 控制和读取状态，并收到 `tool_state_changed` 事件，这样 UI 能与 Agent Core 同步。

## Implementation Decisions

### Agent Core：状态

- Plan Mode 是一个新的 Tool State（name `plan`），快照为 `{ active: boolean }`，默认 `false`。走「地基 B」的 Tool State 机制：每次变化发 `tool_state_changed`，并作为 custom entry 写进 transcript，在 resume、rewind、fork 时恢复。
- Session 暴露 `planMode: boolean` 只读属性和 `setPlanMode(on: boolean)`。`setPlanMode` 幂等，run 进行中也可调用，从下一次模型调用起生效。frontend 的 `/plan` 只调用这个方法。
- 不新增 `SessionEvent` 类型。frontend 通过 `tool_state_changed`（name `plan`）同步 UI。

### Agent Core：提示

- 新增 reminder source `plan-mode`，复用现有 reminder 机制（按内容变化去重，compaction 后重发）。不改 System Prompt，所以进出 Plan Mode 不会让 prompt cache 失效。
- 内容随状态变化：
  - `active`：说明当前处于 Plan Mode，应先探索代码与上下文、不做改动，规划完成后用 `exit_plan_mode` 提交 markdown 计划；计划要写明改动点、步骤和验证方式。
  - 从 `active` 变为不活跃后：只注入一次"已退出 plan mode，可以按计划执行"。之后不再注入，直到下一次进入 Plan Mode。
  - 从未进入过 Plan Mode 的 session 不注入任何 `plan-mode` 内容。
- 文案为英文常量，不走 i18n（Agent Core locale-agnostic，ADR-0008）。

### Agent Core：模型工具

- `enter_plan_mode`：无参数。
  - 走正常的权限判定链。Permission Mode 的放行名单不包含它，因此在 `ask` 和 `auto-review` 下都会进审批框（`auto-review` 不交给 reviewer 自动批准，直接问用户）。`full-access` 下按现有规则自动放行。
  - 已处于 Plan Mode 时返回错误工具结果"already in plan mode"。
  - 放行后打开 Plan Mode，工具结果说明已进入 Plan Mode 以及接下来该怎么做。
- `exit_plan_mode`：参数 `{ plan: string }`（markdown，必填、非空）。
  - 不在 Plan Mode 时返回错误工具结果"not in plan mode"。
  - 在 Plan Mode 时经 `onPlanReview` 交给用户评审，挂起直到用户决定或 run 中止。
  - 加入 Permission Mode 的放行名单：评审本身就是用户决定，不再叠一层审批。
- 两个工具都依赖 `onPlanReview`：frontend 没有提供这个回调时，两个工具都不注册（照「地基 A」，`ask_user_question` 已是这样）。
- 子代理工具集里没有这两个工具。

### Agent Core：评审交互

- 新增 frontend 回调 `onPlanReview(request, signal) => Promise<PlanReviewResult>`，与 `onQuestion` 同形，复用「地基 A」的共享 helper（取消、子代理转发、`origin`）。
- `request`：`{ plan: string, origin? }`。`origin` 保留为字段，但 subagent 不能调用 `exit_plan_mode`，目前总是为空。
- `PlanReviewResult` 三种：
  - `{ kind: "approve" }`：关闭 Plan Mode；工具结果为"计划已批准，开始执行"。
  - `{ kind: "revise", feedback: string }`：保持 Plan Mode；返回错误工具结果，带反馈原文，要求修改后重新提交。`feedback` 可为空字符串，此时文本为"用户要求继续规划"。
  - `{ kind: "takeover" }`：保持 Plan Mode；返回错误工具结果"用户要接手，停下并等待用户的下一条消息"，并设置 pi 工具结果的 `terminate: true`，在这批工具执行完后结束当前 run，不再调用模型。
- run 中止时，挂起的评审以取消结束，`exit_plan_mode` 照「地基 A」以中止结果返回，Plan Mode 状态不变。
- 批准不改变 Permission Mode。
- 评审本身不进 transcript，结果体现在工具结果和 Tool State 里。

### Agent Core：权限

- Plan Mode 不改变任何工具的权限判定。判定链、Permission Rule、Permission Mode 都不读 Plan Mode 状态。
- 「地基 C」原定的"plan 只读作为规则阶段的内置 deny"已被推翻，不实现。

### Agent Core：子代理

- 子代理按引用读取父 session 的 Plan Mode 状态，所以也会收到同样的 `plan-mode` reminder。父 session 切换 Plan Mode 时，子代理从下一次模型调用起感知到变化。
- 子代理没有 `enter_plan_mode` / `exit_plan_mode`：子代理的工具集过滤在 `general-purpose`、`explore` 和自定义类型中一律排除这两个工具，fork 也一样。
- 子代理 transcript 不另外记录 Plan Mode 状态，以父 session 为准。

### Headless CLI

- 不提供 `onPlanReview`，因此两个工具都不注册；Headless CLI 不提供任何打开 Plan Mode 的 flag。
- resume 一个处于 Plan Mode 的 session 时，状态照常恢复，`plan-mode` reminder 照常注入，但模型没有 `exit_plan_mode`，提示里的"用 `exit_plan_mode` 提交"不成立。处理方式：reminder 内容在没有 `exit_plan_mode` 时改为"规划完成后直接以文本给出计划作为最终回复"，Headless 下的 run 就以计划文本结束。

### TUI

- **`/plan`**：TUI 还没有 Slash Command 解析。本 spec 只在 prompt 提交时识别 `/plan`、`/plan <指令>`、`/plan off` 三种形式（不区分大小写，前后空白忽略）：
  - `/plan`：调用 `setPlanMode(true)`，不发 prompt。
  - `/plan <指令>`：先 `setPlanMode(true)`，再把 `<指令>` 作为 prompt 发出。
  - `/plan off`：调用 `setPlanMode(false)`。
  - 其他 `/` 开头的输入照常作为 prompt 发出。
  - 这处判断在 Slash Command 工单落地后迁过去。
- **评审面板**：
  - 照 dsh-TUI，放在审批框的槽位，处于输入框上方面板顺序的最底层，与 QuestionDialog、PermissionDialog 同级，同一时间只会出现一个。
  - 计划用 markdown 渲染，正文区可滚动；高度按对话框优先的预算分配，与其他面板共存。
  - 选项：`1 批准`、`2 继续规划`，下面是一行反馈输入。打字直接进入反馈行；反馈行有内容时数字键按普通字符处理；`Enter` 在选项上按选中项提交，在反馈行上以 `revise` 提交反馈。
  - ↑/↓ 移动焦点，鼠标点击选项或反馈行。`Esc` 以 `takeover` 关闭面板。
  - 交互键位和鼠标行为与现有 QuestionDialog 保持一致，复用它的组件和 hooks。
- **状态呈现**：
  - Plan Mode 下输入框边框换成 design system 的 plan 色（新增 theme token，亮暗两套）。
  - StatusLine 显示 `plan` chip，放在 Permission Mode chip 旁边。
  - ActivityLine 不变。
- **消息流**：
  - `exit_plan_mode` 的工具卡在获批后显示折叠的计划，点击展开 / 收起，展开后用 markdown 渲染。
  - `revise` 时工具卡显示计划和用户反馈。
  - `takeover` 时只显示计划。
  - `enter_plan_mode` 用通用工具卡。
- **i18n**：所有新文案走 `@neant/i18n` 的 TUI 词典，zh / en 齐全。

## Testing Decisions

- 好的测试只看外部行为：模型收到的工具结果和 reminder 文本、`session.planMode`、`tool_state_changed` 事件、工具集里有没有某个工具、resume 后的状态、屏幕快照、CLI 输出。不断言 reminder 去重表、对话框内部焦点 state 等实现细节。
- **Agent Core e2e：`createSession` + faux model**（主接缝，prior art：`tests/e2e/questions.test.ts`、`todo.test.ts`、`todo-reminders.test.ts`、`permissions.test.ts`）。覆盖：
  - `setPlanMode(true)` 后下一次模型调用的 context 里有 `plan-mode` reminder；`setPlanMode(false)` 后只出现一次退出提示，之后不再出现；从未进入过的 session 没有这个 reminder；compaction 后 reminder 重发。
  - `enter_plan_mode` 在 `ask` 和 `auto-review` 下触发 `onPermissionAsk`，被拒时 Plan Mode 不变；已在 Plan Mode 时返回错误工具结果。
  - `exit_plan_mode` 不在 Plan Mode 时报错；`approve` 关闭 Plan Mode 且 Permission Mode 不变；`revise` 返回带反馈的错误工具结果、Plan Mode 不变；`takeover` 后 run 结束、不再调用模型；run 中止时评审以取消结束。
  - 没有 `onPlanReview` 时两个工具都不在工具集里；此时的 reminder 文本改为"直接以文本给出计划"。
  - Plan Mode 下 bash / edit 的权限判定与 Plan Mode 关闭时一致（同样的规则、同样的 Permission Mode 得出同样的结果）。
  - resume、rewind 后 `planMode` 恢复为对应时点的值。
  - 子代理收到同样的 reminder，工具集里没有这两个工具。
- **TUI e2e：`tests/helpers/app` 的 `start()` + 屏幕快照**（prior art：`question-panel-parity.test.ts`、`permissions.test.ts`、`todo-panel.test.ts`）。覆盖：
  - `/plan`、`/plan <指令>`、`/plan off` 的行为；其他 `/` 开头的输入照常发出。
  - 输入框边框和 `plan` chip 随状态变化。
  - 评审面板：`1` 批准、`2` 继续规划、打字进入反馈行并 `Enter` 提交、反馈行有内容时数字键当字符、↑/↓、鼠标点击、`Esc` 接手。
  - 评审面板打开时 todo 面板和子代理面板仍然显示。
  - 中止 run 时面板关闭。
  - 获批后计划折叠在工具卡里，点击展开。
- **CLI**（prior art：`apps/neant-cli/tests/main.test.ts`）：stream-json 输出的工具集里没有 `enter_plan_mode` / `exit_plan_mode`。

## Out of Scope

- Plan Mode 下限制写操作。照 harness，Plan Mode 只引导、不限制；需要只读时由用户切到 `ask`。sandbox 也已在地图上划为 out of scope。
- 批准计划时同时切换 Permission Mode（Claude Code 的"批准并 auto-accept"）。
- 计划文件持久化到磁盘、在 `$EDITOR` 里编辑计划。计划只存在于工具调用参数和 transcript 里。
- 批准后清空上下文再执行（Claude Code 的 clear context 选项）。
- 通用 Slash Command 解析和补全，归 Slash Command 工单。本 spec 只做 `/plan` 的最小前缀判断。
- 子代理提交计划、计划评审转发到子代理。
- Headless CLI 的 Plan Mode flag。
- Desktop frontend。

## Further Notes

- 推翻「地基 C」的"plan 只读作为内置 deny"，并修订「地基 A」的 plan 批准安全默认值为"没有回调时不注册工具"，两处都已在原工单的 Comments 里记录。
- `CONTEXT.md` 新增 **Plan Mode**，**Interaction** 的降级措辞已同步。
- 子代理工单（含输入框上方面板固定顺序）已全部落地：评审面板直接放进固定顺序里的 PermissionDialog 槽位，子代理相关测试与本 spec 一起写。

## Implementation Record

- 2026-10-04：按 01 → 02 / 03 并行执行，每个 issue 均由子代理使用 implement skill 在独立 worktree 中完成 TDD、Standards / Spec 审查和提交。三个 issue 均已 resolved，全部验收项完成。
- 集成顺序：01（`ecdf4ba`）→ 02（`9710a86`）→ 03（`2339846`）；最终版本已合入 main。本次三个 worktree 及已合并开发分支均已移除。
- 审查发现并修复了状态存储失败后的队列恢复，以及混合工具批次中接手后仍调用模型的问题；两轴最终均无未解决发现。新增完整 TUI 进入审批 → Plan Mode → 计划评审 → 退出执行的公共测试，覆盖 ask / auto-review 且 Permission Mode 不变。
- 最终在 main 上以临时隔离 HOME、清除 NO_COLOR 执行 `bun run check`：exit 0；格式、lint、`tsc -b`、knip 与全量测试通过。1178 pass / 0 fail，6416 assertions，90 files，129.21s；日志 `/tmp/neant-plan-mode-main-final-check.log`。
