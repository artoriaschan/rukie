# 04: credential 生命周期

**What to build:** 长时间使用时授权仍然有效：access token 过期后自动刷新；refresh 失效或 server 中途要求重新授权时回到 needs-auth；credential 不会被同名的其他 server 借用；预注册客户端可以用。详见 [MCP OAuth spec](../spec.md) 的 MCP Credential 存储、连接与 needs-auth 两节。

**Blocked by:** 01, 03

**Status:** resolved

- [x] token 失效后由 pi 自动刷新，工具调用照常成功（fake 记录到 refresh 请求）；refresh 返回 `invalid_grant` 时 server 回到 needs-auth，伪工具重新出现
- [x] 工具调用途中遇到 401 / 需要授权：这次调用返回错误，server 标为 needs-auth，下一个 turn 换成伪工具
- [x] 同名但 url 或 headers 不同的 server 用不到已有的 credential
- [x] 配置了 `oauth.clientId` 时不调用 `/register`；`clientSecret` 时使用 `client_secret_post`；`callbackPort` 决定回调端口；`authServerMetadataUrl` 跳过元数据发现
- [x] credentials 文件损坏时发一次 warning、按空处理，下次成功写入前不覆盖原文件
- [x] 未 trusted 项目 `.mcp.json` 中的 OAuth server 不会被加载，不发生任何 OAuth 请求
- [x] e2e 覆盖以上各项

## Implementation and verification

- Implemented on `codex/mcp-oauth-04` from integration `9a3e1be`. OAuth refresh remains owned by pi; mid-tool authorization failures now remove real tools before the next Turn, including Headless runs. Successful credential reuse clears needs-auth memory.
- Capture requested authorization scopes from the passive redirect and pass them to explicit reauthorization. Remember the rejected token so a cancelled scope upgrade does not reconnect the same grant on later Runs; a changed credential from another Session may reconnect.
- Added a narrow OAuth provider helper to enforce `client_secret_post` and lazily seed validated configured HTTPS authorization metadata through pi discovery state. Persisted discovery and configured metadata share the same schema. Existing credential storage queue is unchanged.
- Added public lifecycle tests for refresh before and during a Run, invalid_grant, mid-tool authorization failure with and without interactions, scope step-up and cancelled-login cache, URL and expanded-header isolation, pre-registered clients, fixed callback port cleanup, metadata bypass, and untrusted-project silence. The 03 corruption tests continue to verify one warning and preservation until a successful write.
- Red evidence: real tools remained after mid-tool revocation; configured secret selected Basic when both methods were available; configured metadata was ignored; scope-required cache reconnected an unchanged grant; missing requested-scope forwarding produced tools instead of tools tools:write. All corresponding public regressions now pass.
- Focused: `rtk proxy bun test packages/agent/tests/e2e/mcp.test.ts packages/agent/tests/e2e/mcp-config.test.ts packages/agent/tests/e2e/mcp-oauth.test.ts packages/agent/tests/e2e/mcp-oauth-lifecycle.test.ts packages/agent/tests/e2e/notification-hooks.test.ts apps/neant-cli/tests/main.test.ts` — exit 0, 127 pass, 0 fail, 554 assertions; log `/tmp/neant-mcp-oauth-04-focused.log`.
- Aggregate: isolated HOME with `env -u NO_COLOR bun run check` — exit 0; formatting, lint, TypeScript, Knip and 2255 tests passed, 0 failed, 11572 assertions across 162 files; log `/tmp/neant-mcp-oauth-04-check.log`. Fresh final TypeScript and diff checks also passed.
- HTTPS metadata testing substitutes only one exact external network endpoint; authorization, token exchange and MCP requests use the real local HTTP fixture. No provider credentials, real user settings or hosted account were used.

## Comments

2026-10-06 review fixes: Both explicit-flow and passive providers now record the requested challenge scope and rejected token through the same callback. A public same-Run regression first authenticates, encounters insufficient_scope, requests tools tools:write, invokes the real tool successfully, and observes connected status. One local needs-auth view helper preserves cancellation, logout and authorization-failure side effects.

Final focused MCP/API/lifecycle/TUI/question verification: 198 pass / 0 fail (861 assertions); existing tools-and-notices file: 14 pass / 0 fail (72 assertions). Fresh isolated HOME, env -u NO_COLOR caffeinate -is bun run check: exit 0, 2309 pass / 0 fail, 11818 assertions across 166 files (308.73s), format/lint/types/Knip passed. Final log: /tmp/neant-mcp-oauth-review-check.log. Initial full had only the obsolete Chinese expected-English prefix failure (2308/1); preserved /tmp/neant-mcp-oauth-review-check-before-localized-expectation.log. Both review axes confirm all findings resolved.
