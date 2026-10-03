# 19: MCP 远程传输与 OAuth

Type: grilling
Status: open
Blocked by: 01

## Question

支持 SSE / Streamable HTTP 传输与 OAuth 认证的远程 MCP server。

需定：settings 中 MCP server 配置形状扩展（`url`、`headers`、传输类型）；OAuth 流程（本地回调端口 / 设备码）、token 存储位置与刷新；授权交互走地基 A（TUI 打开浏览器、Headless CLI 如何处理）；连接失败与重连在 MCP server 错误通知中的呈现。先确认所用 MCP SDK 已支持的部分。
