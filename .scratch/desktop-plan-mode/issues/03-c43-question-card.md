# 03：C43 交互卡与问题卡

Status: ready-for-agent

Blocked by: 02

**What to build:** 实现共用组件 C43 交互卡，先接入 `ask_user_question` 问题卡。挂起交互期间，交互卡替换 C04。几何以 rukie.pen 的 `wcVdw`、`knRMo`、`zSVYC` 为准。

- [ ] UI store 和 client：
  - 解析 `question` 类型的 Interaction，并按顺序排队
  - 发送回复 `{ answers }` 或 `declined`
  - 收到结算通知后移除对应交互
- [ ] C43 组件：
  - 基于 beUI 的 approval-card，按 DESIGN.md 调整：宽 752px，圆角 16px，选项行高 48px，悬停时背景为 `$hover` 并显示箭头
  - 末行是卡内输入框，按钮在「跳过」和「提交」之间切换
  - 子智能体来源标签
- [ ] 问题卡：
  - 题目和选项来自模型
  - 多题时分步显示，标出「n / m」，支持前后切换
  - 多选题显示复选框，「提交」按钮固定显示
  - 卡内输入框的内容作为 `custom` 回答
  - 点「跳过」、×，或按 Esc，回复 declined
- [ ] 挂起交互时，C43 替换 C04，草稿保留；多个交互依次显示
- [ ] 键盘：数字键、↑/↓、Enter、Esc；焦点可见，无障碍名称完整
- [ ] 中英文文案，补齐 `tool.ask_user_question` 工具行文案
- [ ] DESIGN.md：把「Pending approval replaces the composer」扩展到问题卡，新增 C43 的几何规则
- [ ] Chromium 测试：
  - 单题、多题、多选、自定义回答、跳过，以及键盘操作
  - 草稿保留，交互排队
  - 窄宽度不溢出，Light 和 Dark 两种主题
