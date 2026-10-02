# 02: 分段条主题 token 与背景色映射

Status: resolved

**What to build:** 见 spec ① 节的主题和 `ThemedText` 部分。

- 在 dark 主题中新增 `barSystem`、`barPrompt`、`barAssistant`、`barThinking`、`barTools`、`barFree`、`barFreeText`，取值照搬 dsh。
- `ThemedText` 的 `backgroundColor` 支持传入主题 token，传原始颜色值时原样透传。

**Blocked by:** —

- [x] `backgroundColor` 传主题 token 时输出对应的 SGR 48，传原始值时行为不变
- [x] 主题测试覆盖新增的 token
- [x] `bun run check` 全绿

## Comments

- 新增 7 个 dark 分段条 token；`ThemedText.backgroundColor` 按当前主题解析 token，保留 hex / ANSI 原始颜色和未指定背景时的嵌套继承。
- 通过公开 `render` + headless xterm 覆盖前景色、背景色、SGR 48、自定义主题及原始颜色兼容性。
- 验证：`rtk proxy env -u NO_COLOR bun test packages/tui/tests`（75 pass）；`rtk proxy env -u NO_COLOR bun run check`（315 pass，格式、lint、类型检查和 Knip 通过）。测试命令移除当前环境的 `NO_COLOR=1`，以验证实际颜色输出。
