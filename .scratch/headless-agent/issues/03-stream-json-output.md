# 03: stream-json 输出

**What to build:** 加上 `--output-format stream-json` 之后，CLI 往 stdout 每行写一个 JSON 事件。事件直接透传 pi 的 `AgentEvent`，外层加上 `sessionId`。事件流以 `session_start` 开头（包含 sessionId、model、cwd、可用工具），以 `result` 结尾（包含最终文本、是否成功、token 用量、耗时）。默认的 text 输出保持不变，警告写到 stderr。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] 事件类型定义放在 `@neant/shared`；同时预先定义好后续 ticket 要用的自定义事件类型：`reminder_injected`、`permission_denied`、`mcp_server_error`、`compaction`
- [ ] stream-json 模式下每个事件都带 `sessionId`，事件顺序为 `session_start` → pi 事件 → `result`
- [ ] Run 失败时同样输出 `result`（标记为失败），退出码不为 0
- [ ] Seam 2 测试校验事件顺序和 `result` 的内容
