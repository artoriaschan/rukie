# 02: 单题单选端到端提问

**What to build:** 模型在 TUI 中调用 `ask_user_question` 问一个单选题，用户在底部提问框选择后，模型下一轮收到 `"问题" → 选项` 的工具结果，run 继续。Headless CLI 下模型看不到该工具。

**Blocked by:** 01（预重构：交互 helper 与 TUI Interaction 队列）

**Status:** ready-for-agent

参考：[spec](../spec.md) 命名、工具 schema、回调契约、注册条件、权限、结果文本、TUI 提问框。

Agent Core：

- [ ] `ask_user_question` 完整 schema（1–4 题、每题 `question`/`header`/`multiSelect`/2–4 个 `{label, description}`）；越界返回校验错误且不调用回调
- [ ] 工具 description 说明 frontend 会自动附加"其他"，模型不必自加
- [ ] `SessionOptions.onQuestion` 契约：请求 `{ toolCallId, questions, signal, origin? }`，返回 `{ answers }` 或 `"declined"`
- [ ] 仅有 `onQuestion` 时注册，含 MCP 连接后工具重建路径；无回调时工具不在列表
- [ ] 任何 Permission Mode 下恒 allow，不触发 `onPermissionAsk` 或 auto-review
- [ ] 结果文本：每题一行 `"<question>" → <label>[, …][; <custom>]`；拒绝 → `isError: false` + declined 提示；回调抛错 → `isError: true`
- [ ] run 中止时挂起提问经交互 helper 以取消结束，回调收到的 signal 已中止
- [ ] 无超时

TUI：

- [ ] 提问框（层级 ③，只接 props）占审批框同一槽位：`header`、问题、选项 `label` + 暗色 `description`
- [ ] `↑↓` 移动、`1-9` 直选、`enter` 确认、`esc` 拒绝回答且 run 继续、`Ctrl+C` 关闭提问 + 取消 run + 保留草稿
- [ ] 与审批在同一 Interaction 队列按 FIFO 逐个显示，审批不插队
- [ ] 提问框打开时按键不改 prompt 草稿；窄 / 矮终端下截断、受 `maxHeight` 约束
- [ ] 文案走 TUI i18n（zh/en），通过硬编码汉字检查

测试：Agent Core seam（`createSession` + fake model + `onQuestion`）与 TUI seam（`start()` + `controlledModel` + stdin 按键）覆盖以上行为。
