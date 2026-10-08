# 01: loadout 同步只写差异

**What to build:** Session 每次请求前的 loadout 同步（`rukie.mcp-loadout`）在可见工具与期望工具不一致时，只移除不再需要的工具并追加新工具，保留已可见工具的位置；只有顺序无法通过"保留 + 追加"得到时才整表替换。这是 Tool Search 保留已发现工具、且不重复写入 schema 的前提。详见 [Tool Search spec](../spec.md) 的"已发现集与工具顺序"。

Blocked by: None (can start immediately)

Status: ready-for-agent

- [ ] MCP server 增加 / 移除工具时，transcript 中的工具变更只包含差异
- [ ] 已可见工具定义变化时按同名重定义处理（移除再追加该工具）
- [ ] 现有 MCP drift、resume、compaction 用例保持通过
- [ ] Agent Core e2e：断言 MCP 工具增删后的 `toolsRemoved` / `toolsAdded` 只含差异
