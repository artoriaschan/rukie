# 03: TUI 待办面板

**What to build:** TUI 用户在输入框上方看到待办面板（复刻 dsh-TUI `GoalTodoPanel` 的 todo 部分），随模型写入实时更新，resume 后立即出现。

**Blocked by:** 01（`todo_write` 写入并在 resume 后恢复）

**Status:** done

参考：[spec](../spec.md)「TUI」；dsh-TUI `src/components/GoalTodoPanel.tsx`。

- [x] app 组件区 `goal-todo-panel`（props only），为 Goal 根行留结构但不渲染 Goal
- [x] 根为折叠头 `▾` + `✓ done/total`（全量计数）；条目 dim `├─ ` / 末行 `└─ `
- [x] 图标 `●` in_progress（强调色）、`✓` completed（dim）、`○` pending（dim）；completed 整行 dim；每行 1 行高截断；按写入顺序
- [x] 最多 8 条，余下 `└─ … N more`
- [x] 运行中显示全部；空闲隐藏已完成项（计数仍全量）；空闲且无未完成项或为空时不渲染
- [x] chat 屏订阅 `tool_state_changed`（`todo`），启动 / resume 用 `session.toolState("todo")` 初始化
- [x] 位于底部区域 activity-line 之后、notice 之前；审批框出现时不渲染；提问框与 todo 共存（2026-10-04 用户修正）
- [x] 所有文案走 TUI 应用字典，中英两份

测试（seam 2：`start` + faux 模型）：

- [x] 树形、图标、计数、8 条上限
- [x] 运行中 / 空闲显隐与全部完成后消失
- [x] 审批框出现时面板不显示；提问框出现时仍显示 todo（2026-10-04 用户修正）
- [x] resume 后面板立即出现
- [x] 中英文案

## Comments

2026-10-04：使用 `/Users/artorias_chan/.agents/skills/implement/SKILL.md`，按 `tdd` 已约定 seam 2（公共 `start` + faux 模型 + 终端屏幕/cells）完成。树形面板先红后绿；40×12 输入/status 被挤出屏幕的回归与审查发现的 PageUp overflow 丢失均经公共红测复现后修复。仅交付 03，04 折叠交互与 05 工具卡仍由后续工单负责。

实现证据：

- `goal-todo-panel` 为 props only，保留 Goal 根层结构但不渲染 Goal；TodoItem 类型经 Agent Core 公共出口复用。实时 `todo` 状态变化与启动/resume 读取由 chat screen 层负责。
- 对照实际 dsh-TUI `src/components/GoalTodoPanel.tsx`，复刻树形前缀、状态图标、completed 整行 dim、单行截断、写入顺序和全量计数；组件保留来源与 MIT 许可。
- 最多 8 条，剩余项走中英字典 overflow；短屏按底部可用高度减少条目，保留全量计数与 overflow。40×12 翻到历史消息时把现有回到底部提示压为一行，输入/status 和待办计数/overflow 都可见。
- 运行中显示所有状态，空闲隐藏 completed；全完成空闲/空列表消失。审批与提问框优先占底部槽位，关闭后面板恢复；英文 resume 无模型请求即恢复清单。

验证证据：

- 新增 `apps/neant-tui/tests/e2e/todo-panel.test.ts`：6 个 seam 2 公共行为测试，最终完整验收中 32 assertions，覆盖树形/8条/full count、ANSI dim/accent、Unicode和多行内容截断、运行/空闲/清空、两种交互遮挡、英文 resume 与 overflow、40×12 输入/status 和 PageUp 溢出提示。
- 初轮聚焦 todo-panel / resume / permissions / questions / fullscreen：70 pass / 0 fail，366 assertions。
- 审查修复后聚焦 todo-panel / fullscreen：17 pass / 0 fail，98 assertions，2.52 秒。
- `rtk proxy bunx tsc -b`：实现与审查修复后均通过。
- 审查前 `rtk proxy env -u NO_COLOR caffeinate -is bun run check`：格式/lint/tsc/Knip/完整测试全部通过，705 pass / 0 fail，4369 assertions，59 files，97.80 秒。
- 最终修复后同一全量命令：所有检查通过，705 pass / 0 fail，4373 assertions，59 files，98.27 秒。未发生 Maintenance Sleep 超时。

## Standards

固定审查基点 `538c256612a1adf4d973922cad1eaca8a40aca0b`；独立 Standards 子代理对初轮与审查修复增量均确认 0 文档标准违规、0 需报告基线异味。screen 统一分配底部空间、组件 props only、公共出口/测试目录/Bun runner/locale 边界和来源许可符合标准。

## Spec

独立 Spec 子代理初轮发现 1 个有效 P2：40×12 + 10 个 pending + PageUp 时回到底部提示占两行，Todo 面板只有计数头，丢失 overflow。已新增公共失败断言并修复 short+todo 时的返回提示高度；复审确认原 P2 关闭，0 新增缺失/越界/错误。其余 03 验收逐项通过。

审查合计：Standards 0 未解决，Spec 0 未解决。

提交：`ce8f036`（面板）与 `5f55bb2a1c0b9e3db9849dba2c63bc0d7a6ae2d0`（审查发现修复）。代码已提交到 main；本地 Markdown tracker 已更新验收项、done 状态与审查/验证证据。

### 2026-10-04 后续需求修正

用户明确要求 todo 与 ask_user_question 同时存在、不能覆盖。上述验收显隐规则已按最新要求更新，原实现记录保留为当时交付证据；此次修正与验证见 [提问面板规格](../../question-panel/spec.md) 和 [审查记录](../../question-panel/review.md)。
