Status: resolved

# ask_user_question 面板复刻与 Todo 共存

2026-10-04 用户要求：`ask_user_question面板的UI、样式及其交互没有完全复刻dsh-TUI，需要更新。并且todo和ask user需要支持同时存在，不能覆盖`。

参考实际本地 dsh-TUI（commit `646740f12c34546d6c195f5b7031be0dc67421a5`）：`src/components/questions/AskUserQuestionPanel.tsx`、`QuestionMinimizedBar.tsx`、`src/screens/Chat.tsx`、`src/utils/keymap.ts`、`src/i18n.ts`、`src/theme.ts`。适配现有 Neant Question 协议支持的普通单选、多选及自定义回答；保持 Agent Core 协议与 transcript 结果格式。

- 展开标题为带折叠箭头和 📋 进度的分隔线；问题标签为 `◈ header`；正文加粗，选项为指针 + 圆点/勾选图标、标签、独立 dim 描述行。宽裕时保留间距和换行；空间有限时窗口化选项、压缩间距，保留当前选项、自定义输入和操作提示。
- 2026-10-04 后续修正：上下切换焦点不再改变选项、自定义输入或提示区域的布局高度，避免抖动；此要求优先于 dsh 的焦点上边距。实现、回归与审查记录见 [布局稳定性修复](layout-fix.md)。
- 自定义回答行常驻，移除编号快捷选择和临时“其他”编辑模式。选项上输入文字附加答案，单选记住附加的选项；Tab 聚焦输入；输入中光标移动、删除、Home/End、CJK/emoji 编辑正确。选项聚焦时仍在输入行声明 IME 光标，样式为普通文字；输入聚焦时用反色块光标。
- 多选 Space 切换，Enter 提交勾选集合与自定义文字。纯自定义回答合法；空回答显示本地化错误，不能提交。鼠标单选立即回答，多选点击切换，点击输入行聚焦，多选提交行可点击；可操作区域有 hover 反馈。
- ←/→ 在选项上切换题目；在输入中只在行首/行尾的普通箭头换题，其他箭头编辑光标。导航不循环；草稿与光标保留。Esc 在后续题返回上一题，在首题拒绝；Ctrl+C 从任意题拒绝整批并继续 Run。最后一题不能绕过尚未确认的题目提交。
- Ctrl+K 或点击标题折叠/展开；折叠显示进度、题目预览、闪烁等待提示。折叠保留答案草稿，允许编辑主输入草稿；折叠状态下 Esc/Ctrl+C 只展开。todo 使用独立的 Ctrl+Q/鼠标折叠状态。
- 括号粘贴与 Ctrl+V/Alt+V 文本粘贴不提交，控制字符与换行压为一行。超过 8000 个 code point 的单次粘贴拒绝并保留草稿；异步粘贴不能污染已经切换或结束的题目。
- Todo List 和 question 面板同时存在，不遮盖对方，统一分配底部高度；40×12 起可操作，长清单/长问题、中文/英文和 resize 不挤掉状态行及回答输入。审批 Interaction 的旧 todo 隐藏规则保留。
- 使用现有 `@neant/tui` 设计系统；Session 与 Interaction FIFO/草稿状态仍由 chat 屏拥有，展示组件仅消费 props。复用 dsh 来源保留 MIT 许可头。中英文文案放应用字典，不修改 Core 本地化。

## 验证

公共 TUI 黑盒 seam：`start` + controlled faux model + headless terminal；断言屏幕文本、颜色、hover、光标、终端尺寸，以及下一次模型 context 的工具结果。TextInput 展示 API 使用公开 `render` + stdin/stdout 验证，不测试内部状态。

最终完整验收：`rtk proxy env -u NO_COLOR caffeinate -is bun run check`。代码审查基线为此次修正前的 `4ecd34ca03375f72361d4daece46899eca9e8781`，按 `code-review` skill 分别检查 Standards 与 Spec。

## Completion

2026-10-04 完成。实现提交 `fde8973`，随后修复双轴审查与主代理核对发现的边界：小窗口直接/异步粘贴、空白自定义提交、旧提交行双击误答下一题、高窗口正文截断、折叠栏首行/亮度与剪贴板返回前焦点变化。

最终完整验收 `rtk proxy env -u NO_COLOR caffeinate -is bun run check`：exit 0；format、lint、typecheck、Knip 全部通过；740 pass / 0 fail，4554 assertions，61 files，103.90 秒。完整输出：`/tmp/neant-question-panel-final-check.log`。

专项 parity 黑盒测试：23 pass / 0 fail，94 assertions；包含 40/60/80 列、12/16/20/24/60 行、双语、颜色、光标、hover、鼠标与键盘、异步剪贴板及 resize。原问题测试、FIFO、transcript/resume 和整个既有测试集一并通过。

独立 Standards 与 Spec 审查及全部复审完成，两个轴均为 0 项未解决；详见 [审查记录](review.md)。todo 旧规格与 03 工单的显隐验收已同步最新用户要求，历史交付记录保留。
