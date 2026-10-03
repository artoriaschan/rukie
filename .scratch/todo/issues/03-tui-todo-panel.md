# 03: TUI 待办面板

**What to build:** TUI 用户在输入框上方看到待办面板（复刻 dsh-TUI `GoalTodoPanel` 的 todo 部分），随模型写入实时更新，resume 后立即出现。

**Blocked by:** 01（`todo_write` 写入并在 resume 后恢复）

**Status:** ready-for-agent

参考：[spec](../spec.md)「TUI」；dsh-TUI `src/components/GoalTodoPanel.tsx`。

- [ ] app 组件区 `goal-todo-panel`（props only），为 Goal 根行留结构但不渲染 Goal
- [ ] 根为折叠头 `▾` + `✓ done/total`（全量计数）；条目 dim `├─ ` / 末行 `└─ `
- [ ] 图标 `●` in_progress（强调色）、`✓` completed（dim）、`○` pending（dim）；completed 整行 dim；每行 1 行高截断；按写入顺序
- [ ] 最多 8 条，余下 `└─ … N more`
- [ ] 运行中显示全部；空闲隐藏已完成项（计数仍全量）；空闲且无未完成项或为空时不渲染
- [ ] chat 屏订阅 `tool_state_changed`（`todo`），启动 / resume 用 `session.toolState("todo")` 初始化
- [ ] 位于底部区域 activity-line 之后、notice 之前；审批框 / 提问框出现时不渲染
- [ ] 所有文案走 TUI 应用字典，中英两份

测试（seam 2：`start` + faux 模型）：

- [ ] 树形、图标、计数、8 条上限
- [ ] 运行中 / 空闲显隐与全部完成后消失
- [ ] 审批 / 提问框出现时面板不显示
- [ ] resume 后面板立即出现
- [ ] 中英文案
