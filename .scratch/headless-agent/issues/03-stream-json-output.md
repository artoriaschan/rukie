# 03: stream-json 输出

**What to build:** 加上 `--output-format stream-json` 之后，CLI 往 stdout 每行写一个 JSON 事件。事件直接透传 pi 的 `AgentEvent`，外层加上 `sessionId`。事件流以 `session_start` 开头（包含 sessionId、model、cwd、可用工具），以 `result` 结尾（包含最终文本、是否成功、token 用量、耗时）。默认的 text 输出保持不变，警告写到 stderr。

Blocked by: 02

Status: resolved

- [x] 事件类型定义放在 `@neant/shared`；同时预先定义好后续 ticket 要用的自定义事件类型：`reminder_injected`、`permission_denied`、`mcp_server_error`、`compaction`
- [x] stream-json 模式下每个事件都带 `sessionId`，事件顺序为 `session_start` → pi 事件 → `result`
- [x] Run 失败时同样输出 `result`（标记为失败），退出码不为 0
- [x] Seam 2 测试校验事件顺序和 `result` 的内容

## Comments

- 2026-10-01：`--output-format text|stream-json` 默认使用 text；非法格式退出 2。JSONL 每行一个事件，pi 事件字段原样透传，只增加 `sessionId`；警告和错误说明写入 stderr。
- 共享事件使用 `SessionEvent<PiEvent>` 泛型，Agent Core 提供 pi `AgentEvent` 的具体类型；shared 不引入 pi 或运行时依赖。已预定义四种后续自定义事件，本票不实现其触发逻辑。
- `session_start` 包含实际 Session id、`provider/id` 模型、cwd 和当前工具名列表；`result` 包含 `text`、`success`、`usage`、`durationMs`，失败时增加 `error`。usage 累计本次 Run 的所有 assistant 消息，包含 input、output、cacheRead、cacheWrite、totalTokens，resume 不累计旧 Run。
- Agent Core 使用可选的 `onEvent` 回调提供有序实时事件，保持既有 `Promise<RunResult>` 和失败拒绝行为；spec 的公开接口说明已同步。最终事件在存储关闭后发出；模型失败退出 1，SIGINT 退出 130。Session 创建前的配置错误仍通过 stderr 和退出码报告。
- Seam 2 覆盖成功顺序与字段、resume 用量、模型失败、实时 delta 后 SIGINT、stderr 警告分流和非法格式；Seam 1 补充多 Turn 用量、工具事件透传以及没有 errorMessage 的模型失败。
- 验证：`bun run check` 通过（格式、lint、`tsc -b`、knip、全量 39 个测试）；规范审查和规格审查各 0 项剩余问题。
