# 09: 向用户提问（ask user）

Type: grilling
Status: resolved
Blocked by: 01

## Question

模型主动向用户提问的工具怎么设计？基于地基 A 的交互通道。

需定：工具 schema（单选 / 多选 / 自由输入、选项数量、是否带预览）；TUI 呈现与键位（与审批对话框的关系）；用户取消时模型收到什么；Headless CLI 降级（按地基 A 规则）；子代理能否调用。

## Answer

2026-10-03 grilling 结论（参考：Claude Code `AskUserQuestion`；dsh-TUI `AskUserQuestionPanel.tsx` + deepseek-harness `packages/interaction/tool-ask-user`）：

1. **命名：** 工具 `ask_user_question`，frontend 回调 `onQuestion`。工具命名约定：与 Claude Code 同名工具对齐，改 snake_case（现有 `glob`/`grep`/`skill` 已符合）。不新增 `CONTEXT.md` 术语，属 Interaction 一种。
2. **schema（照 CC，去 preview）：** 一次 1–4 个问题；每题 `question`、`header`（短标签）、2–4 个必填选项 `{label, description}`、`multiSelect`；无题目 `id`（按下标对应）；自由输入"其他"由 frontend 固定附加，不在 schema。preview（选项侧栏草图 / 代码对比）不做，需要时再加。
3. **不走 permission decision**：永远 allow，交互本身即用户把关。
4. **结果：** 纯文本，每题一行 `"问题" → 选项；附言`，回显问题原文。用户拒绝回答 → `isError: false`，内容为"用户拒绝回答，按你的判断继续或停下等待指示"，run 继续。run 中止按地基 A 以取消结束。无超时，一直等（不做 dsh 的 timed / pending 变体）。
5. **TUI：** 与审批框同一底部槽位，复用 `ListItem`/`HintLine`。所有 Interaction 进同一 FIFO 队列，一次显示一个，审批不插队（区别于 dsh 审批优先）。键位：`↑↓` 选择、`1-9` 直选、多选 `space` 切换、`enter` 确认、多题 `tab`/`←→` 切换、`esc` 拒绝回答整个调用（不做 dsh 的"esc 回上一题"）；选中"其他"就地变输入框。
6. **transcript 呈现：** TUI 对 `ask_user_question` 工具卡片特殊渲染为"问题 → 回答"摘要，直接由 transcript 中的工具参数 + 结果生成，resume 后天然可见，无需额外存储（与地基 A"交互不进 transcript"一致）。
7. **Headless CLI：** 无 `onQuestion`，工具不注册（地基 A 规则）。
8. **子代理：** 工具规则仅为"所在 session 拿得到 `onQuestion` 才注册"；子代理能否拿到交给子代理工单。供其参考的事实：Claude Code 子代理禁用 `AskUserQuestion`；harness 只允许根代理调用，子代理收 `DELEGATED_CALLER` 并被提示把问题写进最终结果。若允许，按地基 A 带 `origin` 转发，提问框标题显示来源。

## Comments

2026-10-06：[TUI 工具卡](20-tui-tool-card.md) 修订 transcript 呈现——`ask_user_question` 不出调用行，改由结果投影出「已回答记录」行（照 dsh）。
