Status: claimed

# Spec: 桌面端计划模式与交互卡

来源：rukie.pen M03-D（C39、C40、C41、C43、C44，页面流程 H19–H23 及 L- 浅色版）。Agent Core 能力见 [Plan Mode](../plan-mode/spec.md) 与 [ask_user_question](../ask-user-question/spec.md)。

## Problem Statement

Agent Core 已经实现了 Plan Mode：Tool State `plan`、`setPlanMode`、`enter_plan_mode`，以及 `exit_plan_mode` 的 approve / revise / takeover 三种评审结果。`ask_user_question` 也已实现。但这些能力只接到了 TUI。

桌面 server 创建 Session 时只传入 `onPermissionAsk`，没有传 `onQuestion` 和 `onPlanReview`。所以桌面端的模型看不到提问和提交计划这两个工具，计划只能作为普通文本回复出现。wire 协议也缺少几样东西：没有切换计划模式的命令，`interaction_requested` 只能承载权限请求，`interaction.reply` 只接受权限回复。

UI 这边也不完整：

- C09 添加面板只有图片附件。
- 输入框没有计划模式状态。
- 没有计划预览卡、交互卡和 Side Pane。
- 现有的会话摘要侧栏是 288px 浮层，样式和 C41 不一致。

## Solution

- 在 C09 添加面板里加「计划模式」开关行。开启后，C04 权限模式右侧显示 C39。首页新聊天也能预先开启，创建 Session 时带入。
- 桌面 server 接入 `onQuestion` 和 `onPlanReview`。模型提问或提交计划时，C43 交互卡替换 C04。问题卡的内容由模型生成；计划评审卡的选项是固定的。
- `exit_plan_mode` 在消息流里显示为 C40 计划预览卡。评审结束后，卡片下方显示一行结果。
- 会话摘要侧栏改造成 C41：宽 300px，从上到下依次是待办卡、子智能体卡、计划卡。
- 新增最小 Side Pane（C44）：标签类型只有「计划」，用来查看完整计划。

## User Stories

1. 作为用户，我希望在「＋」面板里一键开启或关闭计划模式。开启后，这一行的副文案显示「• 已开启」。
2. 作为用户，我希望计划模式开启时，输入框里能看到「计划模式」状态。悬停时它变成关闭按钮，点击就退出计划模式，已输入的内容不清空。
3. 作为用户，我希望在新聊天里先开启计划模式，第一条消息就在计划模式下执行。
4. 作为用户，我希望模型提问时，问题卡替换输入框。我可以用编号或方向键选一个答案，可以多选，也可以在卡内输入框里写其他回答，还可以跳过。
5. 作为用户，我希望模型提交计划后，在消息流里看到计划预览，同时出现计划评审卡。我可以选择批准并执行、继续规划、写修改意见，或者跳过并接手。
6. 作为用户，我希望批准后计划模式退出，权限模式保持不变；继续规划时，计划模式保留。
7. 作为用户，我希望从 C40 的「展开」或会话摘要里的计划卡，在右侧 Side Pane 打开完整计划，并能下载和复制。
8. 作为用户，我希望会话摘要侧栏里集中看到待办、子智能体和最近一次计划。
9. 作为用户，我希望会话正在等待问题回答或计划评审时，侧栏会话行显示等待徽标。
10. 作为键盘用户，我希望交互卡支持以下操作：数字键或 ↑/↓ 选择，Enter 提交，Esc 跳过；焦点可见，无障碍名称完整。
11. 作为用户，我希望断线重连或切换会话后，挂起的问题和计划评审能恢复显示；Run 取消时它们会消失。

## Implementation Decisions

### wire 与 server

- `@rukie/shared` 新增以下内容：
  - 命令 `session.set_plan_mode { sessionId, on }`。
  - `session.create` 增加可选参数 `planMode`。
  - `interaction_requested.request` 改为按 `kind` 区分的联合类型，取值为 `permission`、`question` 和 `plan_review`。`question` 携带 `questions` 和 `origin`；`plan_review` 携带 `plan` 和 `origin`。
  - `interaction.reply` 改为按种类区分的回复：权限回复沿用现有的值；问题回复是 `{ answers }` 或 `declined`；计划评审回复是 `approve`、`revise { feedback }` 或 `takeover`。
  - server 以 TypeBox 校验以上命令和回复，回复种类与挂起请求不符时返回错误码。
- server 的 pending 表扩展为三种交互共用：同一会话里按顺序排队，重连时回放，`epoch` 不匹配时返回 `interaction_stale`。Run 取消时取安全默认值：权限为 deny，问题为 declined，计划评审为 takeover。
- 会话摘要里的 `waitingPermission` 改名为 `waitingInteraction`，三种交互都会触发它。所有使用方同步更新。
- 计划模式状态不新增字段：UI 从 snapshot 的 `planMode` 和 `tool_state_changed { name: "plan" }` 读取。`set_plan_mode` 调用 `session.setPlanMode`，空闲时和运行中都可以调用。
- 接入 `onPlanReview` 之后，桌面端也会暴露 `enter_plan_mode`。它的权限判定固定为 ask，因此走现有的权限审批卡。

### UI

- C09：在附件项后面加「计划模式」行，图标 `list-todo`。点击后切换状态并关闭菜单，副文案在「已关闭」和「• 已开启」之间切换。目标模式、MCP、技能、浏览器、电脑这几行仍不加。
- C39：28px 高，放在权限模式触发器右侧。悬停或聚焦时切换为 `$hover` 胶囊加 x 图标，无障碍名称为「关闭计划模式」。首页没有 Session 时，C39 读取本地预选状态。
- C43 交互卡是共用组件：
  - 宽 752px，圆角 16px，`$input` 表面。选项行高 48px，悬停时背景为 `$hover` 并在右侧显示箭头。末行是卡内输入框：内容为空时按钮显示「跳过」，有内容时变成主按钮「提交」。
  - 有挂起交互时，交互卡替换 C04，同时保留草稿。多个交互依次显示。子智能体发起的交互，标题前显示来源标签。
  - 问题卡：内容来自模型，可以有 1 到 4 道题，按题逐步显示，头部标出「n / m」。多选题用复选框代替编号，并固定显示「提交」按钮。卡内输入框里的文字作为 `custom` 回答提交。点「跳过」、× 或按 Esc，回复 declined。
  - 计划评审卡：标题为「是否按此计划执行？」，副标题显示计划标题。选项文案走 i18n：
    - 「批准并执行」回复 approve。
    - 「继续规划」回复 revise，`feedback` 为空。
    - 在输入框写意见后提交，回复 revise 并附上意见。
    - 点「跳过」、× 或按 Esc，回复 takeover。
- C40：作为 `exit_plan_mode` 工具调用的展示，正文取参数里的 `plan`。计划标题取第一个 Markdown 标题，没有标题就取第一行。卡片头部有三个按钮：下载（保存为 `.md`）、复制、展开（打开 C44）。正文固定 248px 高，底部渐隐。评审结束后，卡片下方显示结果行：「已批准计划」「继续规划」「用户接手」。每提交一次生成一张卡。模型如果没调用工具、直接写文本计划，按普通消息显示。
- C41：替换现有的 Summary 浮层，宽度从 288px 改为 300px。卡片顺序是待办、子智能体、计划，没有内容的卡不显示。计划卡显示 Transcript 里最近一次 `exit_plan_mode` 提交的计划，点击后在 C44 打开它，同时关闭 C41。环境信息和产物展示不在本次范围内。
- C44 Side Pane：按 DESIGN.md 的 Side Pane 合同做成右侧独立框架，C20 标签栏只放计划标签和关闭标签页区域。重复打开同一份计划时，聚焦已有的标签。正文渲染完整 Markdown，支持下载和复制。Side Pane 的开关状态不持久化；恢复会话后，计划内容可以从 Transcript 重建。
- 计划模式和交互相关的文案进入 `app-copy`，中英文同时提供。`enter_plan_mode` 和 `exit_plan_mode` 的工具行文案也要补上。
- DESIGN.md 需要做三处修改：
  - 新增 M03-D 段落，覆盖 C39、C40、C41、C43、C44。
  - 改写 C09 中「only the implemented image attachment action」这条约束。
  - 把 [DESIGN.md](../../DESIGN.md) 里「Pending approval replaces the composer」一条扩展到问题和计划评审。

### 模型引导

- 不需要新增提示词。桌面端提供 `onPlanReview` 之后，`planModeReminder(true)` 会自动切换成「用 `exit_plan_mode` 提交」的版本。`ask_user_question` 自带工具描述。

## Testing Decisions

- server（Bun）：
  - 有问题和计划评审时，pending 表会排队、在重连时回放，`epoch` 过期时返回 stale。
  - 回复种类与挂起请求不符时被拒绝；Run 取消后按安全默认值结算。
  - `set_plan_mode` 在空闲和运行中都生效。
  - 创建 Session 时带 `planMode`，第一次模型调用就收到 plan reminder。
  - 用 fake model 跑一遍 `exit_plan_mode`，三种评审结果各自正确结算。
  - `waitingInteraction` 在三种交互下都能正确派生。
- UI store / client（Vitest Node）：三种 Interaction 的解析、排队和结算；计划模式状态从 snapshot 和 tool state 读取。
- UI 组件（Chromium）：
  - C09 的开关行和副文案。
  - C39 的悬停关闭态和无障碍名称。
  - C43 问题卡：单题、多题分步、多选、自定义回答、跳过，以及键盘操作。
  - C43 计划评审卡：四种操作分别对应的回复。
  - 交互卡替换 C04 后，草稿依然保留。
  - C40 的计划标题提取、下载、复制、展开，以及结果行。
  - C41 的卡片顺序、宽度 300px，以及点击计划卡打开 C44 并关闭 C41。
  - C44 的标签复用、关闭标签和关闭面板。
  - 窄宽度下没有溢出；Light 和 Dark 两种主题。
- 布局回归：按 DESIGN.md 的布局保护门禁执行。Composer 和 Summary 宽度的改动是已获授权的改动，其余布局不能变化。
- 完成后用 agent-browser 做一次验收，使用 `dev:desktop:web --isolated` 和 loopback fake provider。

## Out of Scope

- C41 的环境信息卡（变更、Git 图谱、文件目录、终端、分支、提交推送）和产物展示卡，另开票处理。
- M18 标签页的其他标签类型：C21 新标签页、文件浏览器、侧边聊天、代码审查。
- 在桌面端实现目标模式（C37、C38、C42）。
- 修改 Agent Core 的 Plan Mode 或 `ask_user_question` 契约，例如把计划写入文件、批准时切换权限模式、由模型生成审批选项。
- Headless CLI 的 Plan Mode 参数。

## ADR Coverage

| 决定或修改                                                       | 归属                                                                         | 理由                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 桌面 Frontend 提供问题与计划评审回调，选项语义由 Core 固定       | 沿用 [ADR-0015](../../docs/adr/0015-frontend-interactions-and-plan-mode.md)  | 按交互种类提供回调；计划评审仍由 `exit_plan_mode` 决定，不改为由模型生成问题 |
| Interaction 联合类型、`set_plan_mode`、按种类的回复与安全默认    | 沿用 [ADR-0031](../../docs/adr/0031-desktop-wire-protocol-and-local-auth.md) | 沿用同一 WS、TypeBox 命令校验、`epoch` 关联与重连回放，只扩充消息种类        |
| 计划模式状态由 Tool State 投影，Side Pane 内容从 Transcript 重建 | 沿用 [ADR-0016](../../docs/adr/0016-tool-state-and-context-projection.md)    | 不新增持久化状态；Side Pane 是展示状态                                       |
| C39 / C40 / C41 / C43 / C44 的样式与几何                         | 无需 ADR                                                                     | 属于局部展示，由 rukie.pen M03-D 和 DESIGN.md 维护                           |
