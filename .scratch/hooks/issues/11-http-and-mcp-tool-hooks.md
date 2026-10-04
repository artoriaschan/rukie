# 11: http 与 mcp_tool hook 类型

**What to build:** 用户可以把 hook 写成一个 HTTP 端点或一个 MCP 工具，而不只是 shell 命令。见 [spec](../spec.md)「执行与协议」。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] http：POST 输入 JSON；只有 2xx JSON body 能做决定，其他为非阻断错误；`headers` 中 `$VAR` 只展开 `allowedEnvVars` 列出的变量；默认超时 600s。
- [ ] mcp_tool：经 session 已连接的 MCP 客户端调用，`input` 支持 `${tool_input.x}` 替换；工具结果文本按 stdout 解析；server 未连接为非阻断错误。
- [ ] 去重键按 spec。
- [ ] 测试用 MCP server helper 增加原样返回 `arguments.text` 的 `json` 工具；http 用测试内 `Bun.serve`；覆盖 deny 判定与错误 fail-open。
