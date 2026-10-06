# 03: 建卡前分流

**What to build:** todo、ask user、plan mode、子代理工具不再在 transcript 中出通用工具卡，只由各自的面板或专用行呈现，同一件事只出现一次。见 [spec](../spec.md) 的「建卡前分流」。

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] `todo_write` 成功时不出工具行，只更新 todo 面板；失败时出错误卡
- [ ] `ask_user_question` 不出调用行，结果投影为已回答记录行（沿用现有 `q → answer` 文案）
- [ ] `enter_plan_mode` / `exit_plan_mode` 不出工具行；plan review 结果为独立行，折叠走统一展开机制（`ctrl+o` 与点击）
- [ ] `subagent` / `subagent_fork` / `send_message` / `list_agents` 不出工具行，只保留 `SubagentMessage` 行
- [ ] goal 工具仍出 generic 摘要卡
- [ ] 子代理详情页 tools 页复用新工具卡
- [ ] live 与 resume 两条路径分流结果一致
- [ ] TUI e2e 覆盖以上行为；todo 工具卡摘要、plan review `▸ / ▾` 等旧测试同改同删
