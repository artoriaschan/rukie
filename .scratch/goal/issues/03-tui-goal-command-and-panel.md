# 03: TUI `/goal` 与面板

**What to build:** TUI 用户可以用 `/goal` 系列子命令设定、查看、修改、暂停、恢复、清除 goal。输入框上方面板显示 🎯 根行（PhaseBadge、轮次、计时，blocked 时显示原因），statusline 最前面显示 phase chip，goal 的 round 消息和收尾消息不出现在对话里。界面复刻 dsh-TUI。详见 [Goal spec](../spec.md) 的 TUI 各节。

**Blocked by:** 01 Goal 续跑核心

**Status:** ready-for-agent

- [ ] `/goal` 文法：`/goal`、`/goal <objective>`、`/goal edit <objective>`、`/goal pause|resume|clear`（控制字不区分大小写，其他任意文本视为 objective），替换 Slash Command 框架里的占位
- [ ] run 中只有查看、pause、clear 可用，其余提示"仅空闲可用"；Session API 抛的错渲染为 error notice
- [ ] 查看命令的 notice 输出 Status、Blocker、Objective、Rounds、Activation，以及按当前状态给出的命令提示（照 DSH `commandHint`）
- [ ] 补全菜单中 `/goal` 带参数提示
- [ ] `goal-todo-panel` 根行复刻 dsh-TUI：`🎯` + bold truncate 的 objective，右侧 PhaseBadge `<label> · n/max · <elapsed>`，phase 配色；本地计时器在 complete 时冻结；blocked 时多一行 `│ <reason>`
- [ ] goal 存在时 todo 区块常显；goal 与 todo 都没有时整块隐藏；`ctrl+q` 折叠时根行仍可见
- [ ] statusline 最前显示 chip `<glyph> n/max`，按 phase 着色；无 goal 时不显示
- [ ] 带 goal 来源标记的消息在 live 与回放中都不渲染为用户气泡
- [ ] 收到 `tool_state_changed(goal)` 或 run 结束时刷新；resume 后立即显示 goal 状态
- [ ] 新文案中英两份
- [ ] TUI 测试覆盖 spec Testing Decisions 入口 2（工具卡除外）
