# 05: Interaction 识别 pending

**What to build:** `interaction` 提供 pending interaction 识别，MCP 只提供 kind 判定，删除 `hasPendingMcpInteraction` 的格式解析。详见 [spec](../spec.md)。

Blocked by: 01

Status: ready-for-agent

- [ ] memo 格式只在 `interaction` 中定义
- [ ] `tests/interaction/` 覆盖 pending 识别
- [ ] mcp-oauth 恢复 e2e 通过
