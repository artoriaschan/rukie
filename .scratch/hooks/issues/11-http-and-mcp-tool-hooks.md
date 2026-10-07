# 11: http 与 mcp_tool hook 类型

**What to build:** 用户可以把 hook 写成一个 HTTP 端点或一个 MCP 工具，而不只是 shell 命令。见 [spec](../spec.md)「执行与协议」。

Blocked by: 01

Status: resolved

- [x] http：POST 输入 JSON；只有 2xx JSON body 能做决定，其他为非阻断错误；`headers` 中 `$VAR` 只展开 `allowedEnvVars` 列出的变量；默认超时 600s。
- [x] mcp_tool：经 session 已连接的 MCP 客户端调用，`input` 支持 `${tool_input.x}` 替换；工具结果文本按 stdout 解析；server 未连接为非阻断错误。
- [x] 去重键按 spec。
- [x] 测试用 MCP server helper 增加原样返回 `arguments.text` 的 `json` 工具；http 用测试内 `Bun.serve`；覆盖 deny 判定与错误 fail-open。

## Delivery evidence

- Implemented through `/implement` and public Agent Core e2e TDD in the independent `codex/hooks-11` worktree. Rebased onto main `441fcd1c25b597ff2abc06775a69b4d29d231776`, preserving PermissionRequest / PermissionDenied, after-tool output parsing, asynchronous command lifecycle and handler `if` filtering. The final range-diff showed only import / home-directory surrounding context; runtime changes remained identical.
- HTTP hooks POST the original protocol JSON, expand only allowlisted header variables, and apply decisions only from successful JSON object bodies. Non-success, malformed, primitive and connection-error responses warn and fail open. Error response bodies are cancelled immediately without draining or waiting on an unbounded stream; a real HTTP 503 streaming regression confirms the connection closes before Session disposal.
- MCP hooks use the Session's currently connected clients, substitute nested tool input placeholders while preserving exact JSON value types, and parse tool text as command stdout. Missing connections, MCP error results, malformed JSON and timeouts warn and fail open. Hook calls bypass model tool permission interception; their output follows the shared event protocol.
- Hook budgets own MCP deadlines: hook requests alone set SDK `timeoutMs: 0`, preventing its default 30-second timer from overriding the 600-second default or longer explicit budgets. A real delayed JSON-RPC tool proves default and explicit 35-second budgets both apply a deny after 30.1 seconds; short timeout, cancellation and disposal tests remain green. Ordinary model MCP tool deadlines are unchanged.
- Matching duplicate HTTP / MCP handlers execute once. MCP test helper `json` returns `arguments.text` unchanged; HTTP tests use real `Bun.serve`. Network PermissionRequest tests verify rewritten arguments and in-memory mode updates.
- Independent Standards and Spec reviews of `0d70edd72117fe568223ae52a9e3bc37392fdad0` both reported zero findings after the error-stream and SDK-deadline fixes. Standards validation passed **151 tests**, including the real long-budget regression; Spec validation passed **23 network tests**.
- Post-rebase focused network / filter / after-tool / async / permission tests: **97 pass, 0 fail**, 311 assertions across five files. Formatting, lint, TypeScript and knip passed.
- Fresh full `bun run check` with isolated temporary `HOME` and `NO_COLOR` removed: **1406 pass, 0 fail**, 7297 assertions across 106 files; formatting, lint, TypeScript and knip passed. Evidence: `/tmp/neant-hooks-11-delivery-check.log`.
