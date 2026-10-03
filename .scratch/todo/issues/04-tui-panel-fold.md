# 04: 待办面板折叠交互

**What to build:** TUI 用户可用 `ctrl+q` 或鼠标点击折叠头折叠 / 展开待办面板；折叠后仍能看到当前在做的那一项。

**Blocked by:** 03（TUI 待办面板）

**Status:** ready-for-agent

参考：[spec](../spec.md)「TUI」；dsh-TUI `GoalTodoPanel.tsx` 折叠部分与 `keymap.ts`（`todoFold`）。

- [ ] `ctrl+q` 切换折叠，运行中也有效；不与现有快捷键冲突
- [ ] 折叠头可点击切换，悬停换背景（复用 renderer hover 能力）
- [ ] 折叠时只剩头部 `▸ ✓ done/total` + 一项预览（优先 in_progress，否则首个未完成）
- [ ] 展开时底部显示"Ctrl+Q 折叠"提示（i18n）
- [ ] 折叠状态为屏幕本地状态，默认展开，不持久化

测试（seam 2）：

- [ ] `ctrl+q` 折叠 / 展开与折叠预览
- [ ] 鼠标点击折叠头切换
- [ ] 展开提示中英文案
