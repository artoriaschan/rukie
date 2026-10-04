# 02: PostToolUse 与 PostToolUseFailure

**What to build:** 工具执行后运行 hook：成功时可以给模型附加反馈或替换结果，失败时可以补充排查提示。见 [spec](../spec.md)「接入：after 阶段」。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 工具成功触发 PostToolUse，输入含 `tool_input`、`tool_response`、`tool_use_id`、`duration_ms`。
- [ ] `decision: "block"` + `reason` 或 exit 2：原因作为 system reminder 附在结果上，原结果保留。
- [ ] `additionalContext` 附在结果上；`updatedToolOutput` 为合法 content 数组时替换结果，否则忽略并 `hook_warning`。
- [ ] 工具失败触发 PostToolUseFailure，输入含 `error`、`is_interrupt`、`duration_ms`，只认 `additionalContext`。
- [ ] 参数校验失败、权限拒绝不触发 PostToolUseFailure。
- [ ] Agent Core e2e 覆盖成功 / 失败 / 替换 / 非法替换 / 拒绝不触发。
