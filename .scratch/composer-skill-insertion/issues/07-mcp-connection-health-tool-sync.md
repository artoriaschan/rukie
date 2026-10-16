# 07：MCP 连接健康与工具同步

Status: ready-for-agent
Blocked by: 06

**What to build:** 按 [spec](../spec.md) 的「MCP Host」「状态接口」两节，让长期共享的连接保持健康：意外断开自动恢复，server 更新工具后下个 Turn 可用，中止一个 Run 不影响其他 Session 的连接。

- [ ] `McpServerView.status` 新增 `pending`，表示连接中或重连中，非已连接状态工具数为 0；TUI 面板与 zh/en 文案同步
- [ ] 意外关闭后指数退避重连（初始 1 秒、上限 30 秒、最多 5 次），稳定后计数清零；重连前确认旧一代连接已关闭；需要授权的 server 不重连；断线期间工具调用直接向模型返回错误
- [ ] 订阅 `tools/list_changed`，每个 server 串行同步，整代替换，失败保留上一代并告警；工具名保持不变，Session 在 Turn 边界读取并沿用 loadout 漂移检测
- [ ] Run 开始前等待 `pending` 的 server 落定；中止 Run 只取消等待，不关闭共享连接
- [ ] 状态变化发布 `mcp_servers_changed`
- [ ] Agent Core 端到端测试用虚拟时钟覆盖退避与上限、旧连接确认、`list_changed` 成功与失败、中止 Run 不关连接

## Comments
