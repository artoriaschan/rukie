Status: resolved

# Spec: 向用户提问（`ask_user_question`）

来源：[向用户提问（ask user）](../agent-core-roadmap/issues/09-ask-user.md)；基于 [地基 A：Agent Core → frontend 交互通道](../agent-core-roadmap/issues/01-interaction-channel.md)。

## Problem Statement

模型在 run 中遇到需求不清、要在几个方案间取舍时，只能猜，或者结束 run 用普通回复提问，等用户下一条 prompt。猜错要返工；结束 run 会打断 goal 续跑和多步任务。用户也没法像点选审批那样快速选一个答案，只能手打整句回复。

## Solution

Agent Core 提供模型工具 `ask_user_question`：模型一次提 1–4 个结构化问题，每题 2–4 个选项。TUI 在审批框所在的底部槽位弹出提问框，用户用键盘选择，或者选"其他"自由输入；回答以纯文本作为工具结果交回模型，run 不中断。用户也可以拒绝回答，模型照常继续。Headless CLI 不提供提问能力，模型看不到这个工具。

## User Stories

1. 作为模型，我想在 run 中向用户提一个带选项的问题，这样不必猜测用户意图。
2. 作为模型，我想一次调用提最多 4 个相关问题，这样减少来回轮次。
3. 作为模型，我想给每个选项写 `label` 和 `description`，这样用户理解每个选项的取舍。
4. 作为模型，我想把某题标为多选，这样用户能选多个非互斥选项。
5. 作为模型，我想给每题一个短 `header`，这样提问框能用标签区分多题。
6. 作为模型，我想收到每题一行的纯文本回答，并且回显问题原文，这样不用按下标对应。
7. 作为模型，我想在用户选"其他"时收到用户的原话，这样能处理选项之外的答案。
8. 作为模型，我想在用户拒绝回答时收到明确说明（非错误），这样我能按自己的判断继续或停下等指示。
9. 作为模型，我想在 schema 越界（0 或 5+ 个问题、少于 2 或多于 4 个选项）时收到校验错误，这样我能修正后重试。
10. 作为模型，我想调用 `ask_user_question` 时不触发审批，这样用户不会被问两遍。
11. 作为 TUI 用户，我想提问框出现在审批框所在的底部位置，这样交互位置一致。
12. 作为 TUI 用户，我想用 `↑↓` 移动选择、`enter` 确认，这样操作和审批框一样。
13. 作为 TUI 用户，我想按 `1-9` 直选选项，这样少按几次键。
14. 作为 TUI 用户，我想在多选题里用 `space` 勾选或取消，这样能选多项后一次确认。
15. 作为 TUI 用户，我想在每题选项末尾总能看到"其他"，选中后就地变成输入框，这样能给出选项之外的答案。
16. 作为 TUI 用户，我想在多题间用 `tab` / `←→` 切换，这样能回头修改前面的回答。
17. 作为 TUI 用户，我想看到当前是第几题、共几题，以及每题的 `header`，这样知道进度。
18. 作为 TUI 用户，我想按 `esc` 拒绝回答整个调用，这样不想回答时能快速跳过，run 仍然继续。
19. 作为 TUI 用户，我想按 `Ctrl+C` 时像审批框一样关闭提问并取消 run，这样中止行为一致。
20. 作为 TUI 用户，我想同时到来的审批和提问按到达顺序一次只显示一个，这样不会叠框或被插队打断。
21. 作为 TUI 用户，我想在提问框打开时按键不编辑输入草稿，这样回答不会污染下一条 prompt。
22. 作为 TUI 用户，我想在 transcript 里看到"问题 → 回答"摘要，这样事后知道自己答了什么。
23. 作为 TUI 用户，我想 resume 会话后仍能看到之前的问答摘要，这样上下文完整。
24. 作为 TUI 用户，我想在终端较窄或较矮时提问框仍可用（选项截断、不溢出），这样小窗口也能回答。
25. 作为 TUI 用户，我想提问框文案随 Locale 切换，这样和其他界面语言一致。
26. 作为 Headless CLI 用户，我想模型看不到 `ask_user_question`，这样非交互 run 不会卡在等待回答上。
27. 作为 frontend 开发者，我想通过一个 `onQuestion` 回调接入提问，并收到 `signal`，这样 run 中止时能关闭提问框。
28. 作为 frontend 开发者，我想回调返回结构化回答（每题选中的选项和可选附言）或"拒绝"，这样格式化交给 Agent Core 统一处理。
29. 作为 frontend 开发者，我想在不提供 `onQuestion` 时工具自动不注册，这样不必自己过滤工具。
30. 作为将来的子代理工单作者，我想 `onQuestion` 请求能带 `origin` 字段，这样子代理转发时提问框能标注来源。

## Implementation Decisions

- **命名**：工具名 `ask_user_question`（对齐 Claude Code `AskUserQuestion`，改 snake_case）；frontend 回调 `onQuestion`，是 `SessionOptions` 上与 `onPermissionAsk` 并列的可选项。不新增 `CONTEXT.md` 术语，这是 Interaction 的一种。
- **工具 schema**（typebox，校验失败走 pi 现有的参数校验错误）：
  - `questions`：1–4 项，每项：
    - `question`：string，完整问题；
    - `header`：string，短标签；
    - `multiSelect`：boolean，默认 false；
    - `options`：2–4 项 `{ label: string, description: string }`。
  - 没有题目 `id`，没有 preview。"其他"自由输入不在 schema 里，由 frontend 固定附加，工具 description 要说明这一点，免得模型自己加"其他"选项。
- **回调契约**：
  - 请求 `{ toolCallId, questions, signal, origin? }`，`questions` 原样传入，`origin` 为将来子代理转发预留（形状 `{ subagentId, description }`，本 spec 不产生）。
  - 返回值是二选一：
    - `{ answers: { selected: string[]; custom?: string }[] }`，按下标对应题目，`selected` 是选中选项的 `label`；
    - `"declined"`。
- **注册条件**：所在 session 有 `onQuestion` 时才加入工具列表（工具列表在 session 创建时和 MCP 连接后各重建一次，两处都要遵守）；没有就不注册。Headless CLI 不传回调，自然没有这个工具。
- **权限**：`ask_user_question` 和 `read`/`glob`/`grep`/`skill` 一样，在 permission decision 里永远 `allow`，任何 Permission Mode 下都不进 auto-review，也不进 `ask`。
- **共享 helper**：按地基 A 的规则，把现有 `askPermission` 的"`signal` 已中止就直接返回、和 abort 赛跑、中止后清理监听"抽成 Agent Core 内部的通用交互 helper，审批和提问共用。run 中止时，挂起的提问以取消结束，工具按 pi 的中止语义返回，不产出回答文本。
- **结果文本**（Agent Core 统一格式化，英文，和现有工具结果文案一致；Agent Core 不感知 Locale）：
  - 每题一行，形如 `"<question>" → <label>[, <label>…][; <custom>]`；只填了"其他"时省略选项部分。
  - 拒绝回答时 `isError: false`，内容大意："The user declined to answer. Proceed with your best judgment or stop and wait for instructions."
  - 回调抛错时按普通工具错误处理（`isError: true`）。
- **没有超时**：一直等到用户回答、拒绝或 run 中止。
- **TUI 交互队列**：
  - 把现有审批的挂起队列（权限状态外置于 React，每次按键都读到最新值）泛化成一个 Interaction FIFO 队列，审批和提问按到达顺序排，一次显示一个，审批不插队。
  - "一律允许此工具"的批量放行只作用于队列里的审批项。
- **TUI 提问框**（层级 ③ 组件，只接 props；状态由 ④ chat screen 持有）：
  - 位置：和审批框同一个底部槽位，复用 `ListItem`/`HintLine`/`ThemedText`。
  - 内容：顶部显示 `header` 和进度（第 n / 共 N 题），然后是问题文本、选项（`label` 和暗色 `description`），末尾固定一项"其他"。
  - 键位：
    - `↑↓` 移动，`1-9` 直选；
    - 单选题 `enter` 确认，多选题 `space` 勾选、`enter` 确认；
    - 多题时 `tab`/`←→` 切换，最后一题确认后提交整批；
    - `esc` 拒绝回答整个调用；
    - `Ctrl+C` 和审批框一样：关闭提问、取消 run、保留草稿。
  - "其他"：选中后就地变成单行输入框，`enter` 提交附言，换行会被压平。
  - 提问框打开时按键不编辑 prompt 草稿。窄或矮的终端里选项截断，提问框高度受 `maxHeight` 约束。
  - 文案全部走 TUI i18n 字典（zh/en），遵守禁止硬编码汉字的检查。
- **transcript 呈现**：
  - TUI 的工具卡片对 `ask_user_question` 特殊渲染：标题是一个"提问"摘要，下面每题一行"问题 → 回答"，由 transcript 里的工具参数和工具结果生成，不额外存储。
  - live 渲染和 resume 渲染走同一条路径；拒绝回答时显示"未回答"。

## Testing Decisions

- **好测试**：只测外部行为，也就是模型下一轮 context 里的 toolResult、frontend 收到的回调请求、TUI 屏幕和模型收到的结果；不测内部 helper、队列结构或组件内部状态。
- **Seam 1：Agent Core**（`bun:test`，`packages/agent/tests/e2e/`）。`createSession` 注入 fake model（`fauxToolCall("ask_user_question", …)`）和 `onQuestion`，检查下一轮 context 的 toolResult。覆盖：
  - 有回调时注册，没有回调时工具列表里没有它（也覆盖 MCP 连接后重建工具列表的路径）；
  - 所有 Permission Mode 下都不触发 `onPermissionAsk` 或 auto-review；
  - 单选、多选、只填"其他"、选项加附言的格式化；
  - 拒绝回答时 `isError: false`，内容正确，run 继续；
  - `signal` 中止时挂起的提问以取消结束，回调收到的 `signal` 已中止；
  - schema 越界（0 或 5 个问题、1 或 5 个选项）返回校验错误，不调用回调。
  - 先例：`tests/e2e/tools.test.ts`、`tests/e2e/permissions.test.ts`，以及 `tests/helpers/fake-model.ts`、`aborting-model.ts`。
- **Seam 2：TUI**（`bun:test`，`apps/neant-tui/tests/e2e/`）。用 `tests/helpers/app.ts` 的 `start()` 加 `controlledModel` 驱动真实 Session，往 stdin 写按键，检查屏幕和模型收到的结果。覆盖：
  - `↑↓`/`1-9`/`enter` 单选；`space` 多选；
  - "其他"输入；多题 `tab`/`←→` 切换和回改；
  - `esc` 拒绝回答后 run 继续；`Ctrl+C` 取消 run 并保留草稿；
  - 审批和提问并发时按 FIFO 逐个显示；
  - 提问框打开时按键不改草稿；
  - transcript 摘要在 live 和 resume 后都正确渲染；
  - en Locale 的文案。
  - 先例：`tests/e2e/permissions.test.ts`（并发审批、`Ctrl+C`、草稿保持）、`tests/e2e/resume.test.ts`、`tests/e2e/locale.test.ts`。
- Headless CLI 不单独测：工具不注册已经在 seam 1 的"无回调"用例里覆盖。

## Out of Scope

- preview（选项侧栏草图或代码对比）。
- 超时和 pending 回答（dsh 的 timed 变体）。
- 纯自由输入题（没有选项的题），模型直接用普通回复提问。
- 子代理调用 `ask_user_question`：由子代理工单决定；本 spec 只预留 `origin` 字段。
- plan mode 批准、MCP OAuth 等其他 Interaction：各自另立工单，只复用这里抽出的共享 helper 和 TUI 队列。
- 鼠标操作、粘贴大段文本的特殊处理（换行压平以外的）。

## Further Notes

- 参考实现：
  - Claude Code `AskUserQuestion`：schema 基本照搬，去掉了 preview。
  - dsh-TUI `AskUserQuestionPanel.tsx` 和 deepseek-harness `packages/interaction/tool-ask-user`：Neant 没有沿用它们的超时、"`esc` 回上一题"、审批优先插队。
- 两个参考实现都禁止子代理调用这个工具，子代理工单定夺时可以参考。
- 工具命名约定（对齐 Claude Code 同名工具，改 snake_case）已记在路线图地图的 Notes 里。
