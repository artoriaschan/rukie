# 20: TUI 工具卡复刻 dsh-TUI

Type: grilling
Status: open
Blocked by:

## Question

把 Neant TUI 的通用工具卡（目前是 `ToolCall`：状态图标、一行摘要、`⎿` 下一行截断结果）整体升级为 dsh-TUI `src/components/messages/AssistantToolUseMessage.tsx` + `ToolUseLoader.tsx` 的样式与交互，覆盖所有工具。

charting 中已知的 dsh 行为：

- 状态点：运行中闪烁 `●`；完成后为按类别着色的 `•`（exec / read / write / web / task，主题色）；出错为红色 `✗`。
- 头部：加粗的工具名（可本地化）+ 标题或参数；右侧耗时 chip。
- 正文：挂在 `⎿` 下，折叠为 3 行（diff 为 8 行），后接 `+N lines (ctrl+o to expand)`；点击或 `ctrl+o` 展开。
- 交互：悬停整行变色并出现 `▾`；标题被截断时有 tooltip。
- 按 card 类型分别渲染：diff / terminal / read / search / generic。

需定：

- 复刻范围（split diff、smooth reveal、点击打开文件是否纳入）。
- Agent Core 侧需不需要一个 presentation 层（类似 DSH 的 `presentCall` / `presentResult`），还是由 TUI 从工具名和参数推导。
- 与现有特例卡片（todo、goal、plan review、子代理、ask user）怎么共存。
- Neant 现有 `ctrl+o`、点击等按键是否冲突。

来源：[web fetch](15-web-fetch.md) Q10/Q11。
