# 02: PostToolUse 与 PostToolUseFailure

**What to build:** 工具执行后运行 hook：成功时可以给模型附加反馈或替换结果，失败时可以补充排查提示。见 [spec](../spec.md)「接入：after 阶段」。

Blocked by: 01

Status: resolved

- [x] 工具成功触发 PostToolUse，输入含 `tool_input`、`tool_response`、`tool_use_id`、`duration_ms`。
- [x] `decision: "block"` + `reason` 或 exit 2：原因作为 system reminder 附在结果上，原结果保留。
- [x] `additionalContext` 附在结果上；`updatedToolOutput` 为合法 content 数组时替换结果，否则忽略并 `hook_warning`。
- [x] 工具失败触发 PostToolUseFailure，输入含 `error`、`is_interrupt`、`duration_ms`，只认 `additionalContext`。
- [x] 参数校验失败、权限拒绝不触发 PostToolUseFailure。
- [x] Agent Core e2e 覆盖成功 / 失败 / 替换 / 非法替换 / 拒绝不触发。

## Delivery evidence

- Implemented through `/implement` and public Agent Core e2e TDD in the independent `codex/hooks-02` worktree, rebased onto main `5a642290786c87166226afb9e3a82446ae809049`.
- Successful executed tools trigger PostToolUse with validated / rewritten input, original result and execution-only duration. Block feedback and additional context preserve original content; legal text / image / empty content arrays replace it, and malformed replacements warn and fail open.
- Executed failures trigger PostToolUseFailure with error, interruption state and duration; only event-specific additional context is applied. Parameter validation and permission refusals trigger neither after event. Inherited hooks include child identity.
- Interrupted failures finish their hook under the configured timeout and persist its context with the original tool result; Session disposal cancels that hook immediately. This cancellation behavior is documented in `docs/hooks.md` and covered with real command processes.
- Independent Standards and Spec reviews of `b60689a79cfd3dfc13cee0008558d51a308ce626` both reported zero findings, with respectively **135 pass, 0 fail** and **118 pass, 0 fail**; Spec also verified async PostToolUse feedback does not rewrite or block completed tool results.
- Focused after-tool / async / dispose / compaction / child checks: **60 pass, 0 fail** across five files; permission / PreToolUse / tool checks: **79 pass, 0 fail** across three files. TypeScript, formatting, lint and knip passed.
- Fresh full `bun run check` with isolated temporary `HOME` and `NO_COLOR` removed: **1370 pass, 0 fail**, 7201 assertions across 104 files; formatting, lint, TypeScript and knip passed. Evidence: `/tmp/neant-hooks-02-delivery-check.log`.
