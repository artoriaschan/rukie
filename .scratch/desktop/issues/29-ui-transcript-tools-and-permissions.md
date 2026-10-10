# 29: ui 对话流、工具调用、权限停靠卡与 Queued Input

**What to build:** 对话视图：SessionEvent 归约、虚拟化 Transcript、Turn 折叠与刻度、工具调用行（输出、ANSI、diff）、Markdown 与高亮、权限停靠卡、Queued Input 行、`session_busy` 提示与摘要卡片。见 [spec](../spec.md) 的「主窗口布局」中的主区域、工具调用与权限审批、输入框（Queued Input）。

Blocked by: 25, 28

Status: ready-for-agent

- [ ] `store` 的 SessionEvent 归约（snapshot + 实时事件）用 Vitest Node 环境测试，含流式文本、工具开始与结束、中止与 Interaction
- [ ] Transcript 按 Turn 用 `@tanstack/react-virtual` 虚拟化，底部跟随，上翻停止跟随，`role="feed"`；Turn 折叠、中止与当前 Turn 状态；Turn 刻度跳转与预览
- [ ] 工具调用行：默认折叠、失败展开、`anser` ANSI 输出、`diff` 8.0.4 + 改造后的 `file-diff`（`diff-*` token、按行着色、流式不经 aria-live）
- [ ] Markdown（micromark/mdast → React）与共享 shiki 高亮器（`shiki/core`、github-light/dark、`@shikijs/stream`，缓存有上限）
- [ ] 权限停靠卡：Esc/A/↵、回复后 Turn 内结果行、`interaction_settled` 消失、`interaction_stale` 丢弃、断连禁用、重连补发后重新出现
- [ ] Queued Input 行：立即发送与撤回；停止后按顺序以空行合并回填输入框草稿之前
- [ ] `session_busy`：对话照常显示 snapshot，输入框替换为提示与「重试」
- [ ] 摘要卡片：Todo 进度与子代理状态
- [ ] 接缝同 28；GUI 浏览器验证中实测 TanStack 流式末行增高、Turn 展开与 `scrollToIndex`，并定下高亮跳过或移入 Worker 的输入阈值
