# 06: MCP 的 Session API

**What to build:** frontend 不用解析错误，也能查看各 MCP server 的状态，并发起登录、登出、重连。详见 [MCP OAuth spec](../spec.md) 的 Session API 一节。

**Blocked by:** 03

**Status:** done

- [x] `mcpServers(): Promise<McpServerView[]>`，字段 `{ name, transport, status: connected | needs-auth | failed, toolCount, auth: oauth | headers | none, error? }`；返回上一个 run 的结果；还没有结果时做一次独立探测（连接、listTools、关闭；不注入 reminder，不写 Transcript）
- [x] `authenticateMcp(name)`：走 03 的流程；不是 http server 时报错，没有 `onMcpAuth` 时报错
- [x] `clearMcpAuth(name)`：删除文件中对应的项，并清除 needs-auth 记忆
- [x] `reconnectMcp(name)`：清除 needs-auth 记忆，重新探测该 server，并更新状态
- [x] 后三个方法在 run 进行中调用时返回 busy（与 `compact` / `setModel` 一致）；类型放在 `@neant/shared`
- [x] e2e：第一个 run 前探测，之后返回 run 的结果；clear 后再连接变回 needs-auth；reconnect 后状态更新；busy；预先写好 credentials 文件时 Headless 能直接调用真实工具

## Implementation evidence

- `Session.mcpServers()` returns copied Run snapshots, or shares one independent first probe; probes close in `finally`, never inject reminders or write Transcript. A revision guard makes a newer Run snapshot win over a delayed read-only probe.
- Idle login reuses the OAuth operation from 03; unsupported callbacks reject before requests. Clear deletes only the selected expanded server key through the shared atomic credential queue and clears token/scope failure memory. Reconnect probes only the selected server. `McpServerView` belongs to runtime-agnostic `@neant/shared`.
- Management locks are acquired before awaiting work, exclude Run/model/compaction/rewind/Goal starts, and release after cleanup. Session disposal aborts independent probes and pending login; idle Notification uses the operation signal. Cancelled login preserves needs-auth, and clearing an absent OAuth credential preserves a connected server using configured headers.
- Public red/green regressions cover missing APIs, selected credential deletion, reconnect status, stale probe overwrite, cancelled-login status, and header-auth logout status. Existing MCP assertions remain unchanged.

## Verification evidence

- Latest focused MCP/config/OAuth/lifecycle/API/Headless suite: 127 pass / 0 fail, including 12 new Session API cases and Headless invocation of a real MCP tool using credentials saved by an earlier login.
- `rtk proxy bunx --no -- tsc -b`, `rtk proxy bunx --no -- oxlint`, formatting and `git diff --check` passed.
- Integration `7a65a12` (ticket 04) merged before final verification; refresh, scope handling and provider options preserved.
- Initial isolated aggregate completed 2267 pass / 1 fail in 295.48s: the new header-auth logout regression ran against the earlier module already loaded before its fix. Corrected focused tests pass. Initial log: `/tmp/neant-mcp-oauth-06-check-before-final-status-fix.log`.
- Final isolated aggregate on corrected source: `env -u NO_COLOR HOME=<temporary HOME> caffeinate -is bun run check` exited 0, 2268 pass / 0 fail across 163 files in 298.23s. Log: `/tmp/neant-mcp-oauth-06-check.log`. Temporary HOME was removed; real settings and credentials were never used.

- After the aggregate, merged latest integration `456987187a5ee2238718939824beed58444fd38f` (ticket 05) and routed independent API/probe connections through the same callback-origin wrapper as Run connections. Post-merge MCP/config/OAuth/lifecycle/API/subagent/Headless suite: 133 pass / 0 fail across 7 files in 3.97s. Typecheck, lint, Knip and repository formatting passed. Root will run the final combined aggregate on the integrated feature graph; by coordination, no third individual aggregate was required for this wrapper adoption.
