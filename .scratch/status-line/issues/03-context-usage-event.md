# 03: Agent Core `context_usage` 事件

Status: resolved

**What to build:** 见 spec 中 Agent Core 一节。

- 在 `@neant/shared` 中新增 `context_usage { used, window, segments }` 事件。
- Agent Core 在以下时机发出该事件：Run 开始时（`session_start` 之后）、每个 step 的 assistant `message_end` 之后、`compaction_end` 之后。
- `segments` 每次按当前 transcript 重新估算，按 `ceil(chars/4)` 计。System Reminder 计入 prompt 段，tool call 计入 assistant 段。
- `used` 优先取最后一个 step 的真实 usage（`input + cacheRead + cacheWrite`）。没有真实 usage，或刚做完 Compaction 时，改用估算总和。
- headless CLI 的 stream-json 输出原样透传该事件。

Blocked by: —

- [x] e2e：假 `streamFn` 跑多 step 的 Run，断言事件出现的时机，以及 `used` 等于真实 usage
- [x] e2e：首次 Run 和 resume 时 `used` 取估算值，`window` 等于模型的 `contextWindow`
- [x] e2e：五段归类正确，包括 reminder 和 tool call
- [x] e2e：Compaction 后 prompt 段约等于摘要，其余会话段归零，`used` 回落
- [x] CLI 的 stream-json 输出中包含 `context_usage`
- [x] `bun run check` 全绿

## Comments

- `@neant/shared` 导出 `ContextUsageEvent`；Agent Core 在 `session_start`、每个 assistant `message_end`、`compaction_end` 后按顺序发出该事件。
- Context Usage 从当前有效上下文重算五段，System Reminder 和 Compaction 摘要计入 prompt，tool call 的 name 与 JSON arguments 计入 assistant；保留现有 Compaction 触发逻辑。
- 首次 Run 与 resume 使用估算；同一 Session 后续 Run 保留最新 Turn 的真实输入 usage。输入 usage 全零时回退估算，Compaction 后失效，下一 Turn 完成再恢复真实 usage。
- 5 个公开 Session e2e 覆盖多 Turn、首次与 resume、五段分类、缺失 usage 回退、同一 Run 内 Compaction 后回落；Headless CLI e2e 验证新增事件的顺序和完整 payload。
- 验证：相关 4 个文件的 66 个测试通过；`rtk bun x tsc -b` 通过；`rtk proxy env -u NO_COLOR bun run check` 全绿（320 pass，格式、lint、类型检查、Knip 通过）。移除 `NO_COLOR` 以验证 renderer 的实际颜色输出。
- code-review：Standards 0 findings；Spec 0 findings。
