# 08: MCP

**What to build:** agent 能使用 MCP Server 提供的工具。

- **连接**：通过 `pi-mcp` 连接 stdio 和 Streamable HTTP 两种 server，HTTP 支持配置 headers。
- **配置来源**：用户级的 `~/.neant/mcp.json`（兼容 `mcpServers` 格式）总是加载；项目的 `.mcp.json` 只在 Trusted Project（在 settings 的 `trustedProjects` 里）或加了 `--trust-project-mcp` 时才加载。
- **命名与权限**：MCP 工具命名为 `mcp__<server>__<tool>`，默认禁用，需要授权。
- **instructions**：server 提供的 instructions 通过 System Reminder 注入，并参与增量比较。
- **容错与清理**：单个 server 失败时发出 `mcp_server_error` 事件并继续运行；Run 结束或被中止时关闭所有连接，不留孤儿进程。

**Blocked by:** 03, 04, 06

**Status:** ready-for-agent

- [ ] stdio 和 HTTP 两种传输都可以通过配置连接
- [ ] 项目级 `.mcp.json` 在不受信任时不加载，在受信任或加了 trust 参数时加载
- [ ] MCP 工具默认被权限拦截，用 `--allow-tools 'mcp__<server>__*'` 可以放开
- [ ] server instructions 和 MCP 工具列表的变化会通过 reminder 增量补发
- [ ] server 失败时发出 `mcp_server_error`，Run 继续；结束和中止时子进程都会被回收
- [ ] 在 `tests/helpers` 下提供一个真实的 stdio MCP server 脚本，Seam 1 测试覆盖以上所有行为
