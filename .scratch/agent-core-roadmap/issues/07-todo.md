# 07: todo 工具

Type: grilling
Status: resolved
Blocked by: 02

## Question

模型维护的任务清单怎么设计？与 Goal 独立（deepseek-harness 中两者解耦，仅 TUI 面板合并展示）。

需定：工具 schema（整表覆盖写 vs 增删改）；条目状态集合；配套 reminder（何时提醒模型更新、频率，复用现有 reminders 机制）；按地基 B 的持久化与 compaction 后恢复；TUI 呈现位置（与 Goal 是否共用面板）；Headless CLI 输出。

## Answer

2026-10-04 grilling 结论（术语 **Todo List** 已入 `CONTEXT.md`）。参考：deepseek-harness `packages/todo/tool-todo` 及其 Agent Note `.agents/notes/archived/feature/2026-06-29-todo-write-tool.md`；dsh-TUI `src/components/GoalTodoPanel.tsx`。

1. **工具：单个 `todo_write({ todos })`，整表覆盖。** 不采用 Claude Code V2 的 `TaskCreate/Get/List/Update`：那套为 swarm 共享任务表而生（落盘、文件锁、owner 认领、依赖图），CC 自身也只在交互式 CLI 默认启用，SDK / `-p` 仍用 TodoWrite。Neant 子代理各自独立 session、各有 Todo List，无共享场景。默认启用，不走审批。
2. **条目：`{ content, status }`。** 无 id、无 `activeForm`。content trim 后非空且不重复，否则工具错误。
3. **状态：`pending | in_progress | completed`。** 无 cancelled（删除条目即取消）。不限 `in_progress` 个数，由 description 引导"通常一个"。
4. **生命周期：** 一直保留到模型下次写入，`[]` 清空。不按 run 清空、不在全部完成时自动清空；是否显示交给 frontend。
5. **持久化：** 按地基 B，Tool State `todo`（`tool-state/todo`），完整快照 last-wins。
6. **反馈给模型：** 新增 `ReminderSource` `todo`：列表非空且有未完成项时返回渲染清单，否则 undefined。工具结果为一行纯文本计数（"Updated todo list: N pending, N in progress, N completed."）。接受"改过后下个 run 开始重复注入一次"。不做"N 轮未更新"催促 reminder，实际观察到模型常忘更新再加。
7. **TUI 面板（复刻 dsh-TUI `GoalTodoPanel`）：**
   - 位置：prompt input 上方底部区域，activity-line 之后、notice 之前；审批 / 提问对话框出现时盖住面板。
   - 树形：根节点为折叠头 `▾`/`▸` + `✓ done/total`（计数按全量），条目挂 dim `├─ ` / 末行 `└─ `。组件按 Goal + todo 共用设计，Goal 根行由 Goal 工单补。
   - 图标：`●` in_progress（强调色）、`✓` completed（dim）、`○` pending（dim）；completed 整行 dim，无删除线。每行 1 行高，超长截断，按模型写入顺序。
   - 最多 8 条，余下 `└─ … N more`。
   - 显隐：运行中显示全部；空闲隐藏已完成项；空闲且无未完成项时整块隐藏（Goal 工单会加 `goal 存在` 条件）。
   - 交互：`ctrl+q` 切换折叠（运行中可用，raw mode 下不与 XON 冲突）；鼠标点击折叠头切换，悬停换背景。默认展开，不持久化。折叠时只剩头部一行 + 一项预览（优先 in_progress，否则首个未完成）。展开时底部提示"Ctrl+Q 折叠"。
   - 不复刻：`/settings` 改键、轨迹视图。dsh 硬编码英文（`… N more`、`todos ✓`）一律走 `@neant/i18n`。
8. **transcript 工具卡：** 摘要 `todos ✓ done/total`，下列每个 in_progress 项 `● content`，共最多 4 行；不做前后快照 diff；工具名本地化为"待办清单"。由工具参数渲染，不读 Tool State（回看历史时每张卡显示当时那一版）。
9. **Headless CLI：** stream-json 自动带 `tool_state_changed`；text 模式不输出 todo，不加 flag。
10. **子代理：** 按地基 B，子代理 Todo List 记在自己 transcript，与父互不影响。

## Comments

2026-10-06：[TUI 工具卡](20-tui-tool-card.md) 推翻本票的工具卡 `todos ✓ done/total`——照 dsh 在建卡前分流，`todo_write` 不出工具行，只更新 `GoalTodoPanel`；仅失败时出错误卡。
