# 03: 模型触发 OAuth 授权（端到端）

**What to build:** 模型调用 `mcp__<server>__authenticate`，Agent Core 经 `onMcpAuth` 请用户在浏览器授权。授权完成后，server 的真实工具在当前 run 的下一个 turn 即可用，MCP Credential 保存到本机，之后的 session 直接复用。详见 [MCP OAuth spec](../spec.md) 的 MCP Credential 存储、OAuth 流程、Interaction 回调、伪工具四节。

Blocked by: 02

Status: resolved

- [x] 文件存储实现 `McpOAuthStateStore`：`<homeDir>/.neant/credentials.json`，权限 0600，目录不存在时以 0700 创建；结构 `{ version: 1, mcp: { [key]: { serverName, serverUrl, state } } }`；key 为 `name|sha256(type,url,headers) 前 16 位`；先写临时文件再 rename
- [x] 流程：启动 `OAuthCallbackServer`（127.0.0.1、随机端口、`/callback`、5 分钟），redirect_uri 为 `http://localhost:<port>/callback`；拿到 authorizationUrl 后调用 `onMcpAuth`，同时等待回调；本地回调先到时 abort `signal`；收到粘贴的 `callback-url` 时解析并校验 state
- [x] `authorizeMcp` 换取 token 后存储；关闭回调 server；用新的 transport 重连并 `listTools`；从下一个 turn 起真实工具替换伪工具。工具集的热替换方式按 pi Agent 现状实现，并有测试覆盖
- [x] 结果：成功返回 `Authenticated <server>; its tools are now available.`；`cancelled`、超时、run abort 返回 `User did not complete authentication for <server>.`（`isError: false`），run 继续；OAuth 错误返回工具错误
- [x] 同一个 server 已有授权在进行时，新的调用共享同一个结果；交互开始时触发 Notification hook，`notification_type: "mcp_auth"`
- [x] e2e（注入的 `onMcpAuth` 去 fetch 授权 URL 来模拟浏览器）：完成授权，下一次模型请求只有真实工具、调用成功、文件内容和权限正确；粘贴路径；state 不匹配；取消；abort；并发两次调用只发生一次交互；新 session 复用 credential、不调用 `onMcpAuth`

## Comments

2026-10-06: 已在 `codex/mcp-oauth-03`（基于集成分支 `77701c5`）实现模型发起的 OAuth 授权。`mcp/credentials.ts` 从 unknown 校验文件状态，按服务器身份读取，使用进程内共享写队列、临时文件 0600 与 rename 保留其他服务器凭据；新建目录 0700。坏 JSON/状态在未成功写入前保持原文件，每个 Session 只告警一次。Provider 复用 pi OAuth 协议；显式授权发现被动注册的 redirect_uri 与当前回调不符时重新注册 client。

OAuth 回调在调用 frontend 前开始等待；回调与粘贴/取消竞争，完成后 abort frontend 的 signal 关闭面板。校验粘贴 state，5 分钟回调超时按取消处理；Run 中止或 exchange 中止都不保存晚到 token、不提升工具。相同服务器的并发调用共享结果。Notification 使用 Run signal，授权面板关闭不会取消已经启动的通知。`McpAuthOutcome` 为 `{ type: "authenticated" | "cancelled", server }` 的判别联合，保存在工具结果 details；`connections.authenticate(server, signal?)` 是后续 Session API 的复用 seam。

当前 Run 的 MCP 工具更新通过 pi `prepareNextTurnWithContext` 在工具变更声明之前刷新工具集，保留已有非 MCP 工具、子 Session 限制与 measureTool 包装；真实工具的声明和可执行工具一致，声明也进入 Transcript，resume 后可重建。原 `mcp.test.ts` 未改动。04/05/06/07/08 的刷新/metadata/client 细节、Session 公共命令 API、TUI、Headless 和子代理转发仍由后续工单负责。

TDD 证据：公开 `createSession` 测试首先观察占位工具返回未实现错误，然后完成本地浏览器回调、下个 Turn 真实工具调用及私有凭据；Notification 先重现超时，再修复 signal 生命周期。测试覆盖粘贴、state 不匹配、OAuth 授权错误、用户取消、Run abort、token exchange 中止、共享交互、并发服务器写入、新 Session 复用、resume 后工具声明及坏文件保留。旧 OAuth stub 断言更新为实际取消结果，原权限和 hook 断言保留。

验证：`rtk proxy bun test packages/agent/tests/e2e/mcp-oauth.test.ts packages/agent/tests/e2e/mcp-config.test.ts packages/agent/tests/e2e/mcp.test.ts packages/agent/tests/e2e/notification-hooks.test.ts apps/neant-cli/tests/main.test.ts`：113 pass / 0 fail；focused oxlint、`tsc -b`、`git diff --check` 通过。临时隔离 HOME、清除 NO_COLOR、`caffeinate -is bun run check`：exit 0，2241 pass / 0 fail（161 files，290.37s），format/lint/types/Knip/测试全通过。日志 `/tmp/neant-mcp-oauth-03-check.log`。

2026-10-06 review fixes: Known Agent Core OAuth failures now retain shared typed error details through the existing tool wrapper; model result text remains English. Public model/idle zh/en regressions verify localized frontend notices and unchanged English error results.

Final focused MCP/API/lifecycle/TUI/question verification: 198 pass / 0 fail (861 assertions); existing tools-and-notices file: 14 pass / 0 fail (72 assertions). Fresh isolated HOME, env -u NO_COLOR caffeinate -is bun run check: exit 0, 2309 pass / 0 fail, 11818 assertions across 166 files (308.73s), format/lint/types/Knip passed. Final log: /tmp/neant-mcp-oauth-review-check.log. Initial full had only the obsolete Chinese expected-English prefix failure (2308/1); preserved /tmp/neant-mcp-oauth-review-check-before-localized-expectation.log. Both review axes confirm all findings resolved.
