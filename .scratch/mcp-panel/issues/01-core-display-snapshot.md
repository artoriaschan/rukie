# 01: Core MCP 展示与工具快照

**What to build:** 扩展公开 MCP 快照，让 Frontend 通过同一个 Session 接口显示配置分组、服务器详情与真实工具详情。详见 [spec](../spec.md) 的 Ownership 与 Agent Core 展示数据。

**Blocked by:** none

**Status:** ready-for-agent

- [ ] 从现有配置读取/合并路径保留有效 `user | project` 来源与路径；同名覆盖、Trusted Project 和环境变量展开保持原行为，Frontend 不重读配置。
- [ ] 公开读取返回单一 `McpSnapshot`（servers/configErrors）；整个文件错误与服务器 failed 行分离，部分合法来源保留可用，缺失文件正常为空，既有 Run fail-open/警告不变，所有仓库消费者同步更新。
- [ ] `McpServerView` 补充 HTTP URL 或 stdio command 展示信息；保留配置表达式，排除敏感展开值、URL 凭据/query 值/fragment，不提供 headers、env、clientSecret、args 或 Credential。
- [ ] 使用已有 listTools 结果提供原始工具名、完整描述与输入 schema；不另开连接或请求，不把 authenticate 占位工具列入真实工具。
- [ ] 所有连接/错误/needs-auth/取消/登出/重连与授权替换路径保持完整元数据；不可用工具清空，toolCount 与真实工具数组一致。
- [ ] 共享类型保持 runtime-agnostic，公开出口与仓库消费者同步；快照深拷贝，Frontend 修改不影响模型工具或 Session。
- [ ] 公开 `createSession` 回归覆盖有效来源、不信任隔离、敏感信息隔离、文件级诊断/部分合法来源、原始 schema、工具数组、失效/取消与副本独立性；保留现有 MCP/OAuth/API/Headless 用例。
- [ ] 更新票状态与实际验证证据，完成 focused 与静态检查；本票集成后才启动 02、03。

## Context pointers

- [MCP owner](../../../packages/agent/src/mcp/index.ts)、[Session](../../../packages/agent/src/session/index.ts)、[shared view](../../../packages/shared/src/mcp.ts)。
- [MCP API tests](../../../packages/agent/tests/e2e/mcp-api.test.ts)、[OAuth fixture](../../../packages/agent/tests/helpers/mcp-oauth-server.ts)。

## Comments

2026-10-06：设计已确认，尚未实施。状态通知属于 02；TUI 呈现属于 03、04。
