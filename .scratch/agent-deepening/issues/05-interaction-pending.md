# 05: Interaction 识别 pending

**What to build:** `interaction` 提供 pending interaction 识别，MCP 只提供 kind 判定，删除 `hasPendingMcpInteraction` 的格式解析。详见 [spec](../spec.md)。

Blocked by: 01

Status: resolved

- [x] memo 格式只在 `interaction` 中定义
- [x] `tests/interaction/` 覆盖 pending 识别
- [x] mcp-oauth 恢复 e2e 通过

## Comments

- Interaction now owns pending memo creation, validation, and live native tool-stage recognition through `hasPendingInteraction`; MCP exposes only `isMcpAuthenticationInteraction`. Session startup uses these interfaces; `hasPendingMcpInteraction` is removed.
- Module seam coverage checks recoverable call stages, execution/terminal/abort precedence, invalid identity fields, and identity continuity with a fresh callback epoch. Existing OAuth close/reopen and cancellation e2e coverage is retained.
- TDD: the first pending-recognition test failed on the missing owning interface before implementation; the module tests then passed.
- Focused verification: `env -u NO_COLOR bun test packages/agent/tests/interaction packages/agent/tests/e2e/mcp-oauth.test.ts packages/agent/tests/e2e/mcp-oauth-lifecycle.test.ts packages/agent/tests/e2e/subagent-mcp-oauth.test.ts` — 49 passed, 0 failed, 3.50s (pre-change baseline: 45 passed, 4.34s).
- `bun run check:dev` passed after correcting native fixture types; aggregate verification belongs to final integration acceptance.
- ADR coverage: follows the spec's ADR-0011 module ownership and ADR-0024 native recovery decisions; persisted memo format, frontend callbacks, and cancellation semantics are unchanged.
