# 02：抽出 MCP Host（预重构）

Status: ready-for-agent
Blocked by: None (can start immediately)

**What to build:** 按 [spec](../spec.md) 的「MCP Host」一节与 [ADR-0047](../../../docs/adr/0047-host-owned-mcp-connections.md)，把 Session 内部的 MCP 连接、工具列表、状态快照与授权状态抽到 MCP Host 能力中。这一步每个 Session 仍持有一个私有 MCP Host，行为与现在完全一致；目的是建立后续归属切换所需的接缝。

- [ ] MCP Host 拥有配置解析、连接、工具、快照、授权状态与管理操作；Session 只通过它的接口取得工具集、reminder、Hook 调用和快照
- [ ] `createSession` 接受可选的 MCP Host 注入；未注入时创建私有 MCP Host 并随 Session 关闭
- [ ] Run 的取消信号与连接生命周期解耦的接口准备好，但本票保持现有关闭语义
- [ ] 现有 Agent Core MCP 测试与 TUI MCP 面板测试不改断言全部通过
- [ ] 模块依赖方向符合 ADR-0011 的约束，受影响的类型检查、lint、knip 通过

## Comments
