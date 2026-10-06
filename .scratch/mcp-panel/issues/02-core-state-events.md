# 02: Core MCP 状态变更通知

**What to build:** Core 提交 MCP 展示快照后发出轻量 `mcp_servers_changed`，使可见面板读取当前记录并实时更新。详见 [spec](../spec.md) 的状态通知。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 共享 SessionEvent 增加无完整 schema payload 的 `mcp_servers_changed`；统一快照提交路径，先更新可读记录再通知，无变化不重复通知。
- [ ] 首次 probe、Run 连接、同一 Run 授权成功/再次 needs-auth、管理成功/失败/取消的实际变化均可见；自动状态刷新不增加网络请求或轮询。
- [ ] 缓存读取不通知；首次读取引发 probe 的提交可通知。文件级诊断变化同样发布新快照，不混入伪服务器行。
- [ ] 用户显式 `mcpServers({ refresh: true })` 在空闲时重新读取配置并探测，Run 中 busy；共享在途刷新与同一资源/取消路径，不自动授权。回归覆盖损坏文件修正后重试成功，普通事件刷新不额外连接。
- [ ] 保留旧 probe revision guard、管理锁、取消与 dispose 清理；事件后的公开读取不会看到旧状态，晚到 probe 不覆盖 Run 结果。
- [ ] 单服务器结果只更新对应记录；首次读取前直接管理也不会把全量快照缩为单服务器，公开回归覆盖多服务器首次管理/读取竞态。
- [ ] 保留已有 MCP error/auth_required 事件与既有 Headless 文本/stream-json 语义，更新必要的类型消费者；本票不改 TUI 页面。
- [ ] 公共 Session 订阅测试验证事件/读取顺序、实际变化、同一 Run scopes/授权替换、无事件读取循环与无重复连接，包含微任务边界和 dispose。
- [ ] 更新票状态与 focused/静态验证证据；与 03 独立基于已集成的 01 开发。

## Context pointers

- [Session](../../../packages/agent/src/session/index.ts)、[MCP](../../../packages/agent/src/mcp/index.ts)、[events](../../../packages/shared/src/events/index.ts)。
- [API tests](../../../packages/agent/tests/e2e/mcp-api.test.ts)、[OAuth lifecycle tests](../../../packages/agent/tests/e2e/mcp-oauth-lifecycle.test.ts)、[Headless tests](../../../apps/neant-cli/tests/main.test.ts)。

## Comments

2026-10-06：设计已确认，尚未实施。Frontend 订阅、页面刷新与清理由 04 接线。
