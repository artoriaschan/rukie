# 01: Core MCP 展示与工具快照

**What to build:** 扩展公开 MCP 快照，让 Frontend 通过同一个 Session 接口显示配置分组、服务器详情与真实工具详情。详见 [spec](../spec.md) 的 Ownership 与 Agent Core 展示数据。

Blocked by: none

Status: resolved

- [x] 从现有配置读取/合并路径保留有效 `user | project` 来源与路径；同名覆盖、Trusted Project 和环境变量展开保持原行为，Frontend 不重读配置。
- [x] 公开读取返回单一 `McpSnapshot`（servers/configErrors）；整个文件错误与服务器 failed 行分离，部分合法来源保留可用，缺失文件正常为空，既有 Run fail-open/警告不变，所有仓库消费者同步更新。
- [x] `McpServerView` 补充 HTTP URL 或 stdio command 展示信息；保留配置表达式，排除敏感展开值、URL 凭据/query 值/fragment，不提供 headers、env、clientSecret、args 或 Credential。
- [x] 使用已有 listTools 结果提供原始工具名、完整描述与输入 schema；不另开连接或请求，不把 authenticate 占位工具列入真实工具。
- [x] 所有连接/错误/needs-auth/取消/登出/重连与授权替换路径保持完整元数据；不可用工具清空，toolCount 与真实工具数组一致。
- [x] 共享类型保持 runtime-agnostic，公开出口与仓库消费者同步；快照深拷贝，Frontend 修改不影响模型工具或 Session。
- [x] 公开 `createSession` 回归覆盖有效来源、不信任隔离、敏感信息隔离、文件级诊断/部分合法来源、原始 schema、工具数组、失效/取消与副本独立性；保留现有 MCP/OAuth/API/Headless 用例。
- [x] 更新票状态与实际验证证据，完成 focused 与静态检查；本票集成后才启动 02、03。

## Context pointers

- [MCP owner](../../../packages/agent/src/mcp/index.ts)、[Session](../../../packages/agent/src/session/index.ts)、[shared view](../../../packages/shared/src/mcp.ts)。
- [MCP API tests](../../../packages/agent/tests/e2e/mcp-api.test.ts)、[OAuth fixture](../../../packages/agent/tests/helpers/mcp-oauth-server.ts)。

## Comments

2026-10-06：设计已确认，尚未实施。状态通知属于 02；TUI 呈现属于 03、04。

2026-10-06：Issue 01 由 Core 实施代理认领；基线 `97b5707`，分支 `codex/mcp-panel-01`。使用已确认的 createSession/MCP fixture 公共 seam 进行逐条 red→green 验证。

## Answer

`Session.mcpServers()` 统一返回 `McpSnapshot`；Core 配置合并保留有效 scope/configPath，展示 URL 从原始表达式脱敏，stdio 只展示 command。已有 listTools 结果保存协议工具名、原始描述（缺省为空）与完整输入 JSON Schema，connected 的真实数组与 toolCount 一致，failed/needs-auth 清空工具；所有快照使用独立深拷贝，不影响 Session 或模型声明。文件级错误独立进入 configErrors，合法来源继续可用，缺失文件正常，既有 Run 警告与 fail-open 保持。共享类型和 Agent API 出口、现有 TUI 文本报告及所有仓库测试消费者同步更新；旧报告能显示文件错误而不伪装为空配置。

公开回归覆盖用户/项目覆盖、未受信任隔离、URL 凭据/query/fragment 与默认表达式脱敏、stdio args/env 不泄露、原始/嵌套 schema 与缺省描述、模型声明和快照副本隔离、文件损坏诊断与部分合法来源、登录/登出/重连、授权失效与同一 Run scope step-up。首次 probe、资源关闭、取消、旧 probe revision guard、Headless 和子代理回归保持通过。首次管理完整提交、状态事件与显式 refresh 属于 02；本票没有实现面板或改变 OAuth 真实账号待办。

2026-10-06 验证：依赖安装 `rtk proxy bun install --frozen-lockfile` 成功。公共 snapshot 首条测试修改前失败、修改后通过；TUI 文件诊断测试修改前复现空配置误报、修改后通过。临时 HOME 且 unset NO_COLOR 的 focused MCP/OAuth/API/子代理/TUI/Headless 套件通过 256 tests、1127 assertions、10 files；最终 API 套件通过 24 tests、97 assertions。`rtk proxy bunx --no -- tsc -b` 成功；同样隔离环境中的 `bun run check` 成功：format → lint → types → Knip → 2321 tests、11871 assertions、166 files、0 fail。首次完整检查发现内部占位符的 no-control-regex lint，已移除控制字符并重跑通过；日志保存在仓库外。
