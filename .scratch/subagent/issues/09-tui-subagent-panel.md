# 09: TUI 子代理面板

**What to build:** 输入框上方 todo 面板下方新增子代理面板，复用 todo 面板的结构、样式和工单 01 的高度预算：

- root 行 `▸/▾ 子代理 running/total`，hover 背景同 todo；点 root 切换折叠，折叠状态独立于 todo，不和 Ctrl+Q 共用。
- 节点每行：状态符号、`[type]`、description；点节点进入详情页。
- 空闲时隐藏已结束的节点，全部隐藏时面板不渲染。
- 折叠时只显示第一个 running 节点作预览。
- 与 todo 面板平分剩余高度，一方为空时另一方用全部；空间不够时折叠成 1 行预览。审批框 / 提问框打开时仍显示。

**Blocked by:** 01, 08

**Status:** ready-for-agent

参考：[spec](../spec.md)「TUI」中的「子代理面板」「面板顺序」。

- [ ] TUI e2e：有 running 子代理时面板出现在 todo 面板下方
- [ ] TUI e2e：点 root 折叠 / 展开，todo 面板折叠状态不变；Ctrl+Q 不影响子代理面板
- [ ] TUI e2e：点节点进入详情页
- [ ] TUI e2e：空闲时隐藏已结束项；审批框打开时两个面板同时显示；小高度下各自折叠成预览
- [ ] `tsc -b` 与全量 `bun test` 通过
