# 03：C43 交互卡与问题卡

Status: resolved

Blocked by: 02

**What to build:** 实现共用组件 C43 交互卡，先接入 `ask_user_question` 问题卡。挂起交互期间，交互卡替换 C04。几何以 rukie.pen 的 `wcVdw`、`knRMo`、`zSVYC` 为准。

- [x] UI store 和 client：
  - 解析 `question` 类型的 Interaction，并按顺序排队
  - 发送回复 `{ answers }` 或 `declined`
  - 收到结算通知后移除对应交互
- [x] C43 组件：
  - 基于 beUI 的 approval-card，按 DESIGN.md 调整：宽 752px，圆角 16px，选项行高 48px，悬停时背景为 `$hover` 并显示箭头
  - 末行是卡内输入框，按钮在「跳过」和「提交」之间切换
  - 子智能体来源标签
- [x] 问题卡：
  - 题目和选项来自模型
  - 多题时分步显示，标出「n / m」，支持前后切换
  - 多选题显示复选框，「提交」按钮固定显示
  - 卡内输入框的内容作为 `custom` 回答
  - 点「跳过」、×，或按 Esc，回复 declined
- [x] 挂起交互时，C43 替换 C04，草稿保留；多个交互依次显示
- [x] 键盘：数字键、↑/↓、Enter、Esc；焦点可见，无障碍名称完整
- [x] 中英文文案，补齐 `tool.ask_user_question` 工具行文案
- [x] DESIGN.md：把「Pending approval replaces the composer」扩展到问题卡，新增 C43 的几何规则
- [x] Chromium 测试：
  - 单题、多题、多选、自定义回答、跳过，以及键盘操作
  - 草稿保留，交互排队
  - 窄宽度不溢出，Light 和 Dark 两种主题

## Implementation and verification

C43 uses an opt-in presentation of the installed beUI Approval Card, composing its installed Button, Checkbox, Input and origin Badge; default Approval Card and permission dock geometry remains unchanged. AppConversation dispatches the first Interaction in insertion order. Question replies carry the top-level wire kind and exact identity, and settlement restores the existing draft and focus. Pending plan review stays ahead of later permission requests and blocks the composer for ticket05 to replace its temporary status presentation.

Public Chromium evidence covers single/multiple questions, previous/next answer preservation, multiple selections, custom text, numbers/arrows/Enter, all skip paths including custom-input Escape, IME/editable/modal exclusion, disabled controls, origin, mixed FIFO/settlement, draft/focus restoration, localized tool rows and Light/Dark/narrow geometry. Standalone C43 measures752px/16px corners/48px rows; integrated App measures752px after ticket04 footer integration. The12 new cases passed through vertical red/green and focused acceptance; existing permission/default Approval Card consumer evidence is reused. Scoped `tsc -b packages/ui`, changed-file formatting/lint, docs:update and check:docs passed. Logs and exact source scopes live in the external ticket-03-verification.md handoff record. Root owns aggregate static, desktop package acceptance and the final isolated browser walkthrough; CI is not claimed here.

ADR review follows spec coverage: Interaction FIFO, safe settlement and Frontend presentation retain ADR-0015/0031; this localized beUI presentation introduces no new architecture. Ticket04's C09/C39 copy and DESIGN sections were retained when merging the latest integration before delivery.

Final review repair: multiple-choice arrows move actual enabled Checkbox focus, wrap and preserve selections; Space toggles and Enter submits without native button activation. The shared App reply path retains connected/pending guards, stale settlement, retryable errors, pending cleanup and permission decision metadata. Public red/green and incremental lifecycle evidence is recorded in the external `review-fix-verification.md`; root package evidence remains 327 passed / 1 failed before its corrected Summary consumer case, rather than a claimed full rerun pass.
