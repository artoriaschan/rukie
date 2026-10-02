# 04: 权限对话框与输入框样式

**What to build:** 在 ② 层补上 `Divider`（`─` 铺满宽度，可带标题和颜色 token）、`ListItem`（聚焦时 `❯` 指针 + accent 加粗，未聚焦两格空白）、`HintLine`（subtle 色按键提示）。权限对话框改为：顶部 permission 色 Divider 带标题 `权限确认`，工具名与参数一行，三个选项用 ListItem，底部 HintLine。输入框改为上下两条 promptBorder 色 Divider，中间 `❯ ` + 输入。见 spec 的 ② ③ 节。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] `Divider`、`ListItem`、`HintLine` 从 `@neant/tui` 导出
- [ ] 冒烟测试：权限对话框渲染出 `─` 分隔线，聚焦项为 accent 色加粗
- [ ] 方向键 / 1–3 / Enter / Esc 的权限交互行为不变（现有测试通过）
- [ ] `bun run check` 全绿
- [ ] 手动运行 `neant` 触发一次 ask，确认对话框与输入框视觉
