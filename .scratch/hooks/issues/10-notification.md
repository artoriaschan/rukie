# 10: Notification

**What to build:** agent 每次等用户（审批、提问、plan 评审、MCP 授权）时触发 Notification hook，用户可以借此发桌面通知。见 [spec](../spec.md)「接入：compaction 与交互」。

Blocked by: 01

Status: resolved

- [x] 地基 A 的共享交互 helper 在每次 Interaction 开始时触发，不等待结果。
- [x] 输入带 `message`、`title`、`notification_type` = `permission_prompt` | `question` | `plan_review` | `mcp_auth`，matcher 匹配 `notification_type`；子代理发起的交互带 `agent_id`。
- [x] 不能阻断；输出只认 `systemMessage`。
- [x] Agent Core e2e：审批与提问各触发一次且类型正确，hook 慢时不阻塞交互。

## Delivery evidence

- Implemented through `/implement` with public behavior TDD in the independent native `codex/hooks-10` worktree. Rebased onto main `29a4f75e86d581273f792e0dbfb5642a53bd389e`, preserving hook filters, HTTP/MCP execution, permission handling, after-tool results, async hooks and disposal.
- The shared `requestInteraction` helper starts Notification without waiting for its completion. Permission, question and plan-review callers supply message/title/type; Notification matchers select that type, and child Session inputs carry `agent_id`/`agent_type`. The metadata contract includes `mcp_auth`; there is currently no MCP authorization Interaction to attach, so no new authorization workflow was introduced.
- Notification handlers of every supported execution type accept only `systemMessage` for display. Control decisions, common stopping fields and additional context are ignored with structured warnings. Notification async/asyncRewake output never enters model context or wakes a run, including exit 2. Late notifications remain visible through the existing Session observer after run completion.
- Real command and HTTP tests prove notification execution cannot delay the frontend reply. Tests cover one permission/question notification, plan-review content, matcher selection, child identity, HTTP non-tool `if` filtering, ordinary/async/asyncRewake late output, cancellation and disposal of completed-child background processes.
- Independent Spec review of the final runtime reported zero findings (87 tests passed). Independent Standards review confirmed the prior P2 cancellation race was repaired and reported no further runtime findings (50 tests passed). The remaining P3 test-directory mismatch was fixed by moving the unchanged public cancellation regression to `tests/interaction/interaction.test.ts` and adjusting its import.
- The cancellation regression failed before the fix because synchronous notification cancellation returned `pending`; after installing the abort listener before Notification and checking cancellation before the responder, it returns `deny` without asking the frontend. A public Session test also covers cancellation by a Notification event observer during an unresolved permission request.
- Latest focused interaction / notification / question / plan-review / permission tests: **73 pass, 0 fail**, 277 assertions across five files. Formatting, lint, TypeScript, knip and diff-check passed.
- Fresh full `bun run check` with isolated temporary `HOME` and `NO_COLOR` removed: **1420 pass, 0 fail**, 7379 assertions across 108 files. Formatting, lint, TypeScript and knip passed. Evidence: `/tmp/neant-hooks-10-delivery-check.log`.
