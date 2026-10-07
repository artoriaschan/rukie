# 08: MCP

**What to build:** agent 能使用 MCP Server 提供的工具。

- **连接**：通过 `pi-mcp` 连接 stdio 和 Streamable HTTP 两种 server，HTTP 支持配置 headers。
- **配置来源**：用户级的 `~/.neant/mcp.json`（兼容 `mcpServers` 格式）总是加载；项目的 `.mcp.json` 只在 Trusted Project（在 settings 的 `trustedProjects` 里）或加了 `--trust-project-mcp` 时才加载。
- **命名与权限**：MCP 工具命名为 `mcp__<server>__<tool>`，默认禁用，需要授权。
- **instructions**：server 提供的 instructions 通过 System Reminder 注入，并参与增量比较。
- **容错与清理**：单个 server 失败时发出 `mcp_server_error` 事件并继续运行；Run 结束或被中止时关闭所有连接，不留孤儿进程。

Blocked by: 03, 04, 06

Status: resolved

- [x] stdio 和 HTTP 两种传输都可以通过配置连接
- [x] 项目级 `.mcp.json` 在不受信任时不加载，在受信任或加了 trust 参数时加载
- [x] MCP 工具默认被权限拦截，用 `--allow-tools 'mcp__<server>__*'` 可以放开
- [x] server instructions 和 MCP 工具列表的变化会通过 reminder 增量补发
- [x] server 失败时发出 `mcp_server_error`，Run 继续；结束和中止时子进程都会被回收
- [x] 在 `tests/helpers` 下提供一个真实的 stdio MCP server 脚本，Seam 1 测试覆盖以上所有行为

## Comments

- 2026-10-01：通过固定版本 `@earendil-works/pi-mcp` 0.99.2 连接 stdio 和 Streamable HTTP。stdio 支持 command、args、env，在项目 cwd 启动；HTTP 支持 url 和 headers，type 可以为 http 或 streamable-http，也可根据 url 推断。复用 pi 的内容转换，保留 MCP 工具返回的 isError。
- 每个 Run 读取用户级 `~/.neant/mcp.json`；仅在用户 settings 的 trustedProjects 精确匹配项目目录，或指定 `trustProjectMcp` / CLI `--trust-project-mcp` 时读取 `.mcp.json`。同名配置由受信任项目覆盖；项目 settings 无法自行加入信任列表。未受信任配置即使 JSON 损坏也不会读取。
- MCP 工具以 `mcp__<server>__<tool>` 注册，沿用 beforeToolCall 权限拦截，默认拒绝；settings / CLI 通配模式和 yolo 可以放开。
- server instructions 和工具名称作为独立的 mcp reminder 来源，每个 Run 重新连接和发现。未变化不补发；instructions 或工具列表变化、移除最后一个 server 时增量补发。resume 保留模型上下文及 JSONL Transcript 前缀。
- 单个配置或 server 启动失败、stdio 意外退出、HTTP 工具请求失败均发出 mcp_server_error，警告经 onWarning 默认写 stderr，其余 server 和 Run 继续。正常 MCP isError 只作为工具错误；主动中止及正常关闭不会误报 server 失败。
- Run 的 finally 等待所有 MCP 连接关闭，再发出 result；复用 pi 的 stdio 进程回收和 HTTP session DELETE。已验证正常结束、模型失败、事件回调失败，以及初始化、模型响应、工具调用期间中止时的子进程回收；中止初始化仍保持 session_start / result 事件边界。
- 测试：tests/helpers/mcp-server.ts 为真实 JSON-RPC stdio 子进程；新增 22 个 Seam 1 MCP 测试和 5 个真实 CLI 测试，HTTP 用本地真实服务验证 headers、工具执行、503 降级及 session DELETE。
- 验证：`bun run check` 通过（格式、lint、`tsc -b`、knip、全量 118 个测试 / 612 个断言）。`/code-review` 规范轴 0 项；规格轴发现 HTTP 503 缺少诊断，已以先失败后通过的回归测试修复并复核，无剩余发现。
