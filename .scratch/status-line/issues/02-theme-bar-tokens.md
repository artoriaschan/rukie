# 02: 分段条主题 token 与背景色映射

Status: ready-for-agent

**What to build:** 见 spec ① 节的主题和 `ThemedText` 部分。

- 在 dark 主题中新增 `barSystem`、`barPrompt`、`barAssistant`、`barThinking`、`barTools`、`barFree`、`barFreeText`，取值照搬 dsh。
- `ThemedText` 的 `backgroundColor` 支持传入主题 token，传原始颜色值时原样透传。

**Blocked by:** —

- [ ] `backgroundColor` 传主题 token 时输出对应的 SGR 48，传原始值时行为不变
- [ ] 主题测试覆盖新增的 token
- [ ] `bun run check` 全绿
