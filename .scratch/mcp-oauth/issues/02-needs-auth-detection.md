# 02: needs-auth 识别与 Headless 报错

**What to build:** 需要 OAuth 的远程 MCP server 不再被当作普通错误，而是识别为"需要授权"：frontend 收到 `mcp_auth_required`，有 `onMcpAuth` 时模型看到 `mcp__<server>__authenticate`；Headless CLI 提示用户去 TUI 登录，run 照常进行。详见 [MCP OAuth spec](../spec.md) 的连接与 needs-auth、Headless CLI 两节。

**Blocked by:** None (can start immediately)

**Status:** claimed

- [x] 新增 fake OAuth + MCP fixture（`Bun.serve`），端点：资源元数据、AS 元数据、DCR、`/authorize`、`/token`（authorization_code + refresh）、MCP 端点（没有 token 或 token 失效时返回 401 并带 `WWW-Authenticate`）；测试可以让 token 失效，并读到请求记录
- [x] http server 一律带上由 pi `McpOAuthProvider` 经 `adaptOAuthProvider` 得到的 authProvider；先用内存存储，文件存储在 03 实现
- [x] connect 时遇到 `McpAuthRequiredError` / `McpOAuthAuthorizationRequiredError`：不打开浏览器；发 `mcp_auth_required { server }`，每个 run 每个 server 一次，不发 `mcp_server_error`；Session 在内存里记住，之后的 run 跳过连接
- [x] 有 `onMcpAuth` 时注册 `mcp__<server>__authenticate`（空参数、allow、经过 hooks，工具描述照 spec），没有时不注册。本票调用它只返回"未实现"类工具错误，03 实现完整流程
- [x] 新增 `onMcpAuth` 的 SessionOptions 类型和 `mcp_auth_required` 事件类型（`@neant/shared`）
- [x] Headless CLI：needs-auth 时发带 `needs authentication; run /mcp login <name> in the TUI` 的 `mcp_server_error`；stream-json 同时输出 `mcp_auth_required`；run 正常结束
- [x] e2e：没有 credential 时模型请求只有伪工具、事件正确、第二个 run 不再请求 MCP 端点；CLI `main.test.ts` 覆盖 Headless

## Implementation evidence

- 2026-10-06: public seam `createSession` with a real OAuth/Streamable HTTP fixture first failed with no authentication tool; after adding pi `McpOAuthProvider` + `adaptOAuthProvider`, the model sees only the authentication tool, no frontend interaction runs during discovery, and the second Run does not request the MCP endpoint.
- Authentication tools use the existing permission/hook path with a default allow only for Session-generated auth tools. Explicit deny rules and hook denials remain effective. Execution is deliberately an error stub; ticket 03 owns the OAuth interaction and durable storage.
- `McpAuthRequest`, `McpAuthReply`, and `OnMcpAuth` live in Agent Core and are exported from `@neant/agent`, alongside existing callback types. Shared's runtime-agnostic `ESNext`/`types: []` configuration does not define `AbortSignal`; the `mcp_auth_required` event remains in `@neant/shared`.
- Reusable fixture: `packages/agent/tests/helpers/mcp-oauth-server.ts` supplies protected resource/AS metadata, DCR or preconfigured clients, PKCE validation and one-use authorization codes, rotating refresh tokens, access invalidation, `invalid_grant`, callback errors, and observable HTTP request records. Headless tests load this owned fixture via a runtime URL with an explicit minimal type because their composite TypeScript project excludes Agent Core test sources. An initial static import raised TS6059/TS6307 and emitted an untracked declaration; that generated artifact was removed.
- Focused checks: `rtk bun test packages/agent/tests/e2e/mcp-oauth.test.ts packages/agent/tests/e2e/mcp.test.ts apps/neant-cli/tests/main.test.ts` → 67 pass / 0 fail; `rtk bunx --no -- tsc -b`, `rtk bunx --no -- oxlint`, and `rtk bunx --no -- knip` → exit 0.
