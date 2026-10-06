# 08: TUI /mcp 报告与子命令

**What to build:** TUI 用户用 `/mcp` 查看各 MCP server 的状态，用 `/mcp login|logout|reconnect <server>` 主动登录、登出、重连。照 dsh-TUI 的 `/mcp` 复刻。详见 [MCP OAuth spec](../spec.md) 的 TUI 一节。

**Blocked by:** 06, 07

**Status:** ready-for-agent

- [ ] 新增内置 Slash Command `/mcp`；不带参数时 run 进行中也可用；调用 `mcpServers()`，以多行 notice 写入 transcript：`! /mcp` 标题行（bashBorder 色），内容行 dim、缩进 2，依次为 `MCP 服务器（N）`、`name · status · N 个工具`、有 needs-auth 时的提示行；空状态显示配置路径；首次探测时显示 loading 文案。现有 notice 渲染不了时加 `report` 变体
- [ ] 子命令 `login|logout|reconnect <server>` 只能在空闲时用，分别调用 `authenticateMcp` / `clearMcpAuth` / `reconnectMcp`；成功和失败用 notice（文案照 spec）；缺参数时用 warning 显示用法；run 进行中显示现有的 busy 提示
- [ ] 补全两层：子命令（带描述）、server 名（来自最近一次 `mcpServers()`）
- [ ] zh / en 文案、`/help` 列表同步
- [ ] TUI e2e：各种状态行、needs-auth 提示行、空状态、loading；run 进行中能执行 `/mcp`、子命令显示 busy；`login` 打开 07 的面板，完成后出现成功 notice；`logout` 后再执行 `/mcp` 显示 needs-auth；缺参数；补全
- [ ] 用真实托管 server（如 Notion 或 Linear 的 MCP）手动走一遍完整流程，记录在工单中
