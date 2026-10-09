# 02: 连接与进程语义

Type: grilling

Blocked by: None

Status: resolved

## Question

server 进程承载多少 Session，本机访问如何控制，wire 协议采用什么形态，WS 断连与 sidecar 崩溃、退出时 Run 和 Interaction 如何处理？

## Answer

- 一个 sidecar 承载多个项目和 Session。TUI 与桌面端同时打开同一项目时的写者 lease 行为见 [05](05-research-store-lease-concurrency.md)。
- 访问控制：sidecar 启动生成一次性 token，Electron 经 preload 注入，浏览器开发模式经 URL 或终端输出传入；同时校验 `Origin` 与 `Host`。只监听 `127.0.0.1`。
- 协议复用 Headless stream-json 的 SessionEvent，加上客户端命令（run、steer、abort、Interaction 响应）；SessionEvent 可做破坏性修改以同时服务 Headless 与 GUI。
- WS 断连：Run 继续，Interaction 保持挂起；重连后 server 补发 Session snapshot 与挂起 Interaction。窗口真正关闭时由 desktop 显式 abort。
- sidecar：随机端口，stdout 输出 `{port, token}` 握手；退出后 main 通知 renderer 并自动重启一次，丢失的 Run 按 ADR-0009 恢复语义处理；应用退出先 graceful shutdown（abort Run、清理 Background Job 进程组），超时再 kill。超时与次数等细节留给 spec。
