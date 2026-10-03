# 02: TUI 模式切换与状态栏显示

Status: ready-for-agent

**What to build:** TUI 用户按 shift+tab 在 `ask → auto-review → full-access → ask` 间循环切换，切换立即作用于 session；状态栏 row 2 第一个字段始终显示当前模式。见 spec Implementation Decisions 的 TUI 节。

**Blocked by:** 01

- [ ] shift+tab 循环切换并调用 `session.setPermissionMode`
- [ ] 审批对话框打开时 shift+tab 被忽略
- [ ] 切换只作用于当前 session，不写回 settings；resume 回到默认模式
- [ ] 切换不注入任何 system reminder
- [ ] 状态栏 row 2 第一位 `mode` 字段，`full-access` 用 danger 色；hover 详情含模式说明与 shift+tab 提示
- [ ] StatusLine 仍只收 props（mode 由 chat screen 传入）
- [ ] chat screen / status-line 测试覆盖以上行为
