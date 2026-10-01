# 复用 pi-agent-core 的 harness 组件，不用 pi-coding-agent，也不完全自研

在 `@earendil-works/pi-agent-core` 0.99.2 的基础上构建：直接复用其中的 `Agent` loop、hooks、`loadSkills`、read/write/edit/bash 工具、compaction 和 session repo；MCP 用 `@earendil-works/pi-mcp`。自己实现的部分包括：System Prompt、System Reminder 注入、权限判定（挂在 `beforeToolCall` 上）、grep/glob 工具和 CLI。

## Considered Options

- 只用 pi-ai 和 loop，其余全部自研：可控，但要重写 pi 里已有的东西，工作量大。
- 基于 pi-coding-agent SDK：依赖太重（会带进 pi-tui、quickjs 等），存储也被绑定在它的 JSONL 格式上。
