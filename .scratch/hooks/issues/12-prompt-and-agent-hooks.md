# 12: prompt 与 agent hook 类型

**What to build:** 用户写一句自然语言规则，由 LLM 判定是否放行；需要看代码时可以用一个只读小 agent 核查。见 [spec](../spec.md)「执行与协议」。

**Blocked by:** 01

**Status:** resolved

- [x] prompt：`$ARGUMENTS` 替换为输入 JSON，单次调用 review model（`model` 覆盖时解析该模型），输出 `{ ok, reason? }`；`ok: false` 视同 deny / block。默认超时 30s。
- [x] agent：以 read / glob / grep 跑一个无 transcript 的临时 run，最终输出 `{ ok, reason? }`。默认超时 60s。
- [x] 输出解析失败为非阻断错误。
- [x] Agent Core e2e 用 `fakeModel` 脚本化 review 回复，覆盖放行、拒绝、坏输出。

## Delivery evidence

- Implemented through `/implement` and public Agent Core e2e TDD in the independent native `codex/hooks-12` worktree. Final rebase onto main `cae77f38a0f1ca2431e1c7e6da54ebed5d1ee7ba` retains hook filters, command async lifecycle, permission request/denial, after-tool results, HTTP/MCP execution and display-only Notification behavior. Final range-diff retained all runtime changes; four commits were identical and the first changed only surrounding Notification guard context.
- Prompt hooks substitute the complete input JSON and perform one isolated review request. Agent hooks use an ephemeral Agent with only `read`, `glob` and `grep`, with no parent transcript, usage or messages. Both use the Session stream function and select the configured review model unless the handler supplies an override resolved through `resolveModel`.
- Valid `{ ok, reason? }` output allows or maps rejection to the event's supported deny/block behavior. Tool rejection prevents execution; PermissionRequest rejection handles headless approval; Stop rejection continues the existing Run; PostToolUse rejection retains a successful tool result and adds feedback. Events without a blocking decision remain unaffected.
- Default model budgets are 30 seconds for prompt and 60 seconds for agent, with handler overrides. The shared `executeBounded` owns deadline and cancellation; the ephemeral Agent aborts on its combined signal. Timeouts, unavailable models and malformed output warn and fail open. User cancellation and disposal abort pending hook work; late stream failures cannot change the parent Run or become unhandled rejections.
- The initial Spec P2 identified JavaScript string replacement tokens inside `$ARGUMENTS`. Public prompt/agent tests first failed and then passed after changing replacement to a callback; `$&`, `$'`, the dollar-backtick token and `$$` now remain literal in the original input JSON. The Standards P3 duplicate timeout mechanism was removed by reusing `executeBounded`.
- Independent fresh Spec and Standards reviews of `7168ea16c93a3e88978384765ab204b3fe8b7da0` both reported zero findings after fixes. Fresh validation passed 27 model tests / 112 assertions and 45 focused tests respectively. Earlier integration review also covered all five handler types and real long-budget MCP execution.
- Final model Notification tests use a slow review handshake: frontend approval and the actual tool complete without awaiting the review; `{ ok: false }` cannot block, inject model context or write review data to the parent JSONL. Model / Notification integration: **42 pass, 0 fail**, 213 assertions. Formatting, lint, TypeScript and knip passed.
- Fresh full `bun run check` with isolated temporary `HOME` and `NO_COLOR` removed: **1449 pass, 0 fail**, 7512 assertions across 109 files; formatting, lint, TypeScript and knip passed. Evidence: `/tmp/neant-hooks-12-delivery-check.log`.
