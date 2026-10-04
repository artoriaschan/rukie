# 02: `exit_plan_mode` 与计划评审

**What to build:** 模型在 Plan Mode 下用 `exit_plan_mode { plan }` 提交 markdown 计划，用户在 TUI 里评审。

- 评审交互 `onPlanReview`（走「地基 A」）有三种结果：
  - 批准：退出 Plan Mode，工具结果告知模型开始执行。Permission Mode 不变。
  - 继续规划：附带反馈，作为失败的工具结果返回，模型留在 Plan Mode。
  - Esc 接手：返回"用户要接手"，并设 `terminate: true`，结束当前 run，模型留在 Plan Mode。
- run 中止时评审以取消结束。不在 Plan Mode 时调用报错。
- 工具只在 frontend 提供 `onPlanReview` 时注册；子代理工具集里没有它；Headless CLI 也没有它。
- Headless resume 一个处于 Plan Mode 的 session 时，reminder 改为让模型直接以文本给出计划。
- TUI：评审面板放在固定顺序里的 PermissionDialog 槽位，计划用 markdown 渲染、可滚动；`1`/`2` 选择，打字进入反馈输入行，`Enter` 提交，`Esc` 接手，支持鼠标点选。消息流里 `exit_plan_mode` 的工具卡在获批后显示折叠的计划，点击可展开；继续规划时显示计划和反馈。

**Blocked by:** 01

**Status:** resolved

- [x] e2e：批准后 `planMode` 为 false，工具结果为成功，退出提示注入一次
- [x] e2e：继续规划时反馈出现在失败的工具结果里，`planMode` 仍为 true，模型继续下一轮
- [x] e2e：Esc 接手后 run 结束、不再调用模型，`planMode` 仍为 true
- [x] e2e：run 中止时评审取消；不在 Plan Mode 时调用报错
- [x] e2e：没有 `onPlanReview` 时工具不注册；子代理工具集里没有它
- [x] CLI：Headless 工具集里没有 `exit_plan_mode`；resume Plan Mode session 时 run 以文本计划结束
- [x] TUI e2e：评审面板的按键、反馈输入、Esc、鼠标点选；工具卡折叠 / 展开计划
- [x] `tsc -b` 与全量 `bun test` 通过

## Answer

Implemented `onPlanReview` and conditional `exit_plan_mode` registration. Approval closes Plan Mode without changing Permission Mode; revision preserves feedback in an error tool result; takeover stops the Run after the complete tool batch. Abort cancels the pending review and ignores late answers. All subagent types and Headless CLI omit the review tool; Headless resume returns a text plan.

The TUI uses the shared Interaction FIFO and the fixed dialog slot below Todo and subagents. Markdown plans scroll with PageUp/PageDown and the mouse wheel. Numeric selection, feedback typing and editing, arrow focus, mouse choices, Escape takeover and run cancellation are covered through terminal IO. Approved plans have collapsible cards, revisions show feedback, and persisted approved cards replay on resume. All new frontend copy is localized in zh/en.

Two-axis code review against `ecdf4ba` found one Spec P1: pi 0.99.2 only terminates a tool batch when every result opts in, so takeover beside an ordinary tool initially allowed another model call. Fixed in `6d89855` using the public `finishTurn` hook after all sibling results are emitted; the Run still settles its active children before closing the store. Regression tests cover both tool orders, retained Todo/results, an active child and the next user Run. Standards and Spec re-review reported no unresolved findings.

Validation: isolated temporary HOME with NO_COLOR unset, `bun run check` exit 0; 1157 tests passed, 0 failed, 6276 assertions across 87 files (128.30s). Includes formatting, lint, `tsc -b`, knip and the full Bun test suite. Final log: `/tmp/neant-plan-mode-02-takeover-check.log`.
