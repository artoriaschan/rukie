# 06: 其余内置工具与 MCP 的 view

**What to build:** read、grep、glob、web_fetch、MCP、goal、job 工具都有各自的卡片样式，不再只是原始文本。见 [spec](../spec.md) 的「Presenter」与「TUI 工具卡」。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] read 出 read view，标题为路径，正文为文本内容
- [ ] grep 出 search `matches` 形态（按文件分组 + `n: line`），glob 出 `paths` 形态；截断时显示总数
- [ ] web_fetch 出 web view，标题为 URL，正文以 Markdown 渲染并受折叠规则约束
- [ ] MCP 工具出 generic view，`kind: other`，标题由 frontend 拼成 `server › tool`
- [ ] goal 工具出 generic 摘要卡；job 工具有 view；后台 bash 为 generic 卡 + JobCard 行，JobGroupHeader 保留
- [ ] 现有 TUI 中按工具名零散拼摘要的特例（web_fetch 首行等）删除，统一走 view
- [ ] Agent Core e2e 断言各工具 view；TUI e2e 覆盖各卡片渲染
