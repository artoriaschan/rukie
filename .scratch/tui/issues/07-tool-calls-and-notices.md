# 07: 显示工具调用和系统提示

**What to build:** 用户能看到 agent 在做什么。每个工具调用显示一行“名字和参数摘要”，跑的时候带 spinner，结束后折叠成一行，用 ✓ 或 ✗ 表示结果，出错时显示错误的前几行。compaction 和 MCP server 报错显示成一行灰色提示。

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] 工具调用开始后，活动区出现“名字和参数摘要”（截断到一行）和 spinner
- [ ] 结束后折叠成一行，用 ✓ 或 ✗ 表示结果，并进入 `Static`；出错时在下面显示错误的前几行
- [ ] 一个 turn 里有多个工具调用时，各自独立显示和折叠
- [ ] `compaction` 和 `mcp_server_error` 事件各显示一行暗色提示；system reminder 不显示
- [ ] 测试走假终端 seam，用假 `streamFn` 返回工具调用
- [ ] `bun run check` 全绿
