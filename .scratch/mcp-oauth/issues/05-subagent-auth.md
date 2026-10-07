# 05: 子代理授权

**What to build:** 子代理遇到需要授权的 server 时，也能通过 `authenticate` 请用户授权，授权面板经父 session 转发给用户；授权结果父子共用。详见 [MCP OAuth spec](../spec.md) 的 Interaction 回调一节。

Blocked by: 03

Status: resolved

- [x] 子代理（`subagent` / `subagent_fork`）在 needs-auth 时拿到伪工具；它的 `onMcpAuth` 请求经父 session 的顶层回调转发，带上 `origin`
- [x] 子代理授权后，父 session 的下一个 run 直接可以使用该 server，不再交互
- [x] Headless 下子代理同样没有伪工具
- [x] e2e：参照 `subagent-permissions.test.ts` 中 `origin` 转发的写法

## Implementation and verification

- Implemented on `codex/mcp-oauth-05`, based on integration `7a65a12`. Added an OAuth callback wrapper beside the existing question wrapper; requests carry the child Session id and description while original top-level callbacks are forwarded once through child creation.
- Default general-purpose and fork children inherit evolving tools only for MCP servers already present in the parent tool set. Other tool names remain fixed. Explicit type.tools lists stay exact, including an authenticate-only type that cannot acquire data tools after successful authorization. No wildcard syntax or configuration change was introduced.
- Public TDD regression first reproduced successful child authorization followed by Tool mcp__srv__echo not found; the next slice reproduced missing child origin. Both subagent and subagent_fork now authenticate and execute the real MCP tool in their next Turn, and the parent next Run uses the shared credential without another interaction.
- Six new public tests also cover Headless children without authenticate tools, cancelled child authorization as a non-error result with unchanged parent needs-auth memory, and explicit restrictions preventing both unrelated-server tools and real data calls.
- Focused: `rtk proxy bun test packages/agent/tests/e2e/subagent-mcp-oauth.test.ts packages/agent/tests/e2e/subagent-permissions.test.ts packages/agent/tests/e2e/subagent-types.test.ts packages/agent/tests/e2e/subagent-fork.test.ts packages/agent/tests/e2e/mcp-oauth.test.ts packages/agent/tests/e2e/mcp-oauth-lifecycle.test.ts` — exit 0, 70 pass, 0 fail, 283 assertions; log `/tmp/neant-mcp-oauth-05-focused.log`.
- Aggregate: isolated HOME with `env -u NO_COLOR bun run check` — exit 0; formatting, lint, TypeScript, Knip and 2261 tests passed, 0 failed, 11610 assertions across 163 files; log `/tmp/neant-mcp-oauth-05-check.log`.
