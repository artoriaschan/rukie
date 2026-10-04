# 01: 输入框上方面板固定顺序

**What to build:** 不加新功能，先让 TUI 输入框上方的区域可容纳子代理面板。chat 屏幕在一处声明从上到下的固定顺序：ScrollToBottom → ActivityLine → TodoPanel → (SubagentPanel 预留位) → QuestionDialog → PermissionDialog → PromptInput → StatusLine。审批框打开时 todo 面板不再隐藏。高度预算改为先满足 PermissionDialog / QuestionDialog，剩余行数分给面板；面板分到的行数不够展开时以 1 行折叠预览显示，不会消失。预算逻辑抽成面板可共用的函数，供工单 09 复用。

**Blocked by:** None (can start immediately)

**Status:** claimed

参考：[spec](../spec.md)「TUI」中的「面板顺序」。

- [ ] 顺序在一处声明；审批框始终紧贴 PromptInput
- [ ] 审批框或提问框打开时 todo 面板仍显示
- [ ] 小高度下 todo 面板折叠成 1 行预览，不被隐藏
- [ ] 现有 TUI e2e 测试按新布局更新，新增"审批框 + todo 面板同时显示"的快照测试
- [ ] `tsc -b` 与全量 `bun test` 通过
