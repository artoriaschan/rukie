# 06: 同步 dsh-TUI 回到底部按钮

Status: resolved

## Scope

用户要求回到底部提示同步 dsh-TUI 样式和位置，水平居中，并支持点击回到底部。

- 参考 dsh-TUI `src/screens/Chat.tsx` 的 `NewMessagesPill`：放在正文下方、活动行/权限弹窗/输入区域上方，顶部留一行空白，使用粗体深色文字和蓝色背景，悬停时背景变色。
- 普通/未读两种按钮状态在 80/60/40 列水平居中。保留 Neant 的 `Ctrl+End` 快捷键和未读布尔语义，不引入消息计数。
- 点击与 Ctrl+End 共用回到底部动作，恢复底部跟随、清除未读并隐藏按钮；保留草稿，权限弹窗打开时不确认权限。
- `StatusLine` 提示行只负责 hover 明细、`esc 中断` 和空占位；移除滚动提示 prop，避免重复展示。
- 在 40×12 等短窗口中保留至少一行正文及完整权限选项/详情、弹窗底部边距和状态栏提示；预算不足时压缩按钮顶部空行及重复的等待活动行。
- 为 `Box` 增加公开 `onClick`：左键在同一绘制目标按下/释放时触发一次；裁剪、滚动、resize 后的命中正确，释放到外部/右键/孤立释放不触发。

## Testing

沿用已约定的公开 render + 假 stdin + headless xterm 接缝，验证实际终端字符/颜色/粗体/位置与输入事件；通过真实 Chat 入口验证跟随、草稿、footer hover、空闲与权限弹窗行为。保留 Ctrl+End 的端到端回归覆盖。

## Answer

新增 `ScrollToBottom` 展示组件与主题 badge/inverse 色：普通/未读状态在 80/60/40 列居中，顶部留一行空白，悬停改变背景。Chat 把按钮放在正文下方、活动行/权限弹窗/输入框上方；点击和 Ctrl+End 共用动作，返回底部后隐藏按钮并恢复跟随，保留草稿与待确认权限。StatusLine 移除滚动提示 prop，保留 hover/中断/空占位。

SGR 主键按下/释放通过公开输入事件送到渲染器，`Box.onClick` 使用真实绘制的命中链，只激活最近的点击目标。支持滚动裁剪，resize 取消未完成按下，右键/孤立释放/外部释放不激活，不编辑 TextInput。

审查发现 40×12 权限弹窗与按钮会挤掉提示行，已通过统一 chrome 预算修复：必要时压缩按钮顶部空行和重复等待活动行，保留正文一行、审批详情/选项/帮助、底部间距以及完整状态栏。端到端验证点击仍不会确认权限。

验证：组件的两种状态在 80/60/40 列颜色/粗体/位置/hover/click 均通过；公开渲染器点击、裁剪/滚动、resize 和输入保持测试通过；Chat 流式/空闲/审批、草稿保留和 Ctrl+End 回归通过。最终 `rtk proxy env -u NO_COLOR bun run check` 全绿：490 tests / 2859 assertions / 0 fail，格式、lint、类型检查及 Knip 通过。Standards 与 Spec 复审均 0 findings。
