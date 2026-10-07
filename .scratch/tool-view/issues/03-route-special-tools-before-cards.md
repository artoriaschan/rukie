# 03: 建卡前分流

**What to build:** todo、ask user、plan mode、子代理工具不再在 transcript 中出通用工具卡，只由各自的面板或专用行呈现，同一件事只出现一次。见 [spec](../spec.md) 的「建卡前分流」。

**Blocked by:** 01, 02

**Status:** resolved

- [x] `todo_write` 成功时不出工具行，只更新 todo 面板；失败时出错误卡
- [x] `ask_user_question` 不出调用行，结果投影为已回答记录行（沿用现有 `q → answer` 文案）
- [x] `enter_plan_mode` / `exit_plan_mode` 不出工具行；plan review 结果为独立行，折叠走统一展开机制（`ctrl+o` 与点击）
- [x] `subagent` / `subagent_fork` / `send_message` / `list_agents` 不出工具行，只保留 `SubagentMessage` 行
- [x] goal 工具仍出 generic 摘要卡
- [x] 子代理详情页 tools 页复用新工具卡
- [x] live 与 resume 两条路径分流结果一致
- [x] TUI e2e 覆盖以上行为；todo 工具卡摘要、plan review `▸ / ▾` 等旧测试同改同删

## Answer

- Shared pre-card projection handles live results and Session.messages replay identically. Successful todo calls update only the panel; failures retain ToolCall error cards. Questions produce q → answer records, including unanswered/cancelled/error records without a generic call row. Plan review is an independent row whose click and Ctrl+O use the shared expansion state. Other plan/subagent failures remain visible as dedicated notices.
- Subagent delegation/fork/continuation creates only the latest dedicated SubagentMessage row; listing/active steering adds no generic card. Child tools retain arguments, full result text and call/result views and reuse ToolCall in the detail Tools page.
- Removed conversation goal JSON parsing/name suppression, todo summaries and web first-line heuristics. Goal compact bodies and all tool styles now come from their presenters, completing ticket06's deferred removal.
- Public verification: start + headless terminal tests cover successful/failed todo and question live/resume, approved/revised plan expansion and replay, all four subagent tool names (new fork/list/failed-send live/resume case), detail tools, resize/focus/reading-position, goal generic summaries and full web body.
- Red: successful todo e2e reproduced the duplicate card (2 failures, 455ms). Green: 57 relevant tests across 7 files passed in 10.12s; the new fork/list/failed-send replay test took 155.66ms. Updated legacy write/resume assertions to the integrated diff path-title and thinking rows; focused checks passed. All new/modified tests are under one second.
- Integration sync: merged ticket06 tip c187ae6 and ticket07 tip 6aabdda, preserving presenter bodies, unified diffs and syntax highlighting. Reinstalled locked dependencies. Post-sync check:dev passed; 15 child-detail/remaining-view/syntax tests passed in 3.96s. Final aggregate gate is owned by the integration branch coordinator.
