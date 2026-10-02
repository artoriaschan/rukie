# 03: 主题与消息流样式

**What to build:** 在 `@neant/tui` 建立 ② 设计系统的主题部分，并让对话消息流用上它。主题为唯一的深色主题，10 个 token 及取值见 spec 的 ② 节表格；`ThemeProvider` / `useTheme` 提供主题，`ThemedText` / `ThemedBox` 的 `color` 接受 token 名；字形常量集中定义（`⏺`/`●` 按平台、`❯`、`⎿`、`•`、`✗`、`·•●•`）；`StatusIcon` 按 running / success / error 渲染。用户可见效果：user 消息 `❯` 前缀，assistant 消息 accent 色 `⏺` 前缀（流式中同样），工具调用显示状态点、结果与错误以 `⎿` 引出（错误 error 色，最多 3 行），notice 为 warning 色、run 错误为 error 色，状态栏 subtle 色且 Running 时状态词为 accent 色。

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] 主题、Provider、Themed* 组件、字形常量、`StatusIcon` 从 `@neant/tui` 导出
- [ ] `ThemedText` 把 token 解析成主题 hex 的测试（读回 cell 前景色）
- [ ] neant 入口包上 `ThemeProvider`，③ 层消息、工具、notice、状态栏不再出现写死的颜色字面量或 `dimColor`
- [ ] 现有测试中受字形变化影响的断言已更新，`bun run check` 全绿
- [ ] 手动运行 `neant` 并触发一次工具调用，确认上述视觉
