# 03: Agent Core `context_usage` 事件

Status: ready-for-agent

**What to build:** 见 spec 中 Agent Core 一节。

- 在 `@neant/shared` 中新增 `context_usage { used, window, segments }` 事件。
- Agent Core 在以下时机发出该事件：Run 开始时（`session_start` 之后）、每个 step 的 assistant `message_end` 之后、`compaction_end` 之后。
- `segments` 每次按当前 transcript 重新估算，按 `ceil(chars/4)` 计。System Reminder 计入 prompt 段，tool call 计入 assistant 段。
- `used` 优先取最后一个 step 的真实 usage（`input + cacheRead + cacheWrite`）。没有真实 usage，或刚做完 Compaction 时，改用估算总和。
- headless CLI 的 stream-json 输出原样透传该事件。

**Blocked by:** —

- [ ] e2e：假 `streamFn` 跑多 step 的 Run，断言事件出现的时机，以及 `used` 等于真实 usage
- [ ] e2e：首次 Run 和 resume 时 `used` 取估算值，`window` 等于模型的 `contextWindow`
- [ ] e2e：五段归类正确，包括 reminder 和 tool call
- [ ] e2e：Compaction 后 prompt 段约等于摘要，其余会话段归零，`used` 回落
- [ ] CLI 的 stream-json 输出中包含 `context_usage`
- [ ] `bun run check` 全绿
