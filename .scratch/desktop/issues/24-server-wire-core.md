# 24: server 鉴权握手、订阅与流式对话

**What to build:** 可端到端运行的最小 server：随机端口与 stdout 握手、WS 鉴权、项目与 Session 列举、新建与订阅、发送、abort，SessionEvent 原样转发。见 [spec](../spec.md) 的「server」「wire 协议与鉴权」与 [ADR-0030](../../../docs/adr/0030-desktop-server-hono-and-effect.md)、[ADR-0031](../../../docs/adr/0031-desktop-wire-protocol-and-local-auth.md)、[ADR-0032](../../../docs/adr/0032-desktop-shares-jsonl-store.md)。

Blocked by: 21, 23

Status: ready-for-agent

- [ ] 只监听 `127.0.0.1` 随机端口，stdout 输出 `{port, token}`；Host、Origin、token 任一不符都拒绝升级，`rukie.v1` 为回显的 subprotocol
- [ ] 开发标志下额外放行 Vite 地址，非开发模式拒绝
- [ ] 桌面端注册表 `homeDir/.rukie/desktop/registry.json`：`projects.list`、`project.add`、默认工作区目录首次使用时创建
- [ ] `sessions.list` 汇总各注册 cwd，单个目录失败不影响其余
- [ ] `session.create` 一步创建并发送首条消息；`session.subscribe` 先发 snapshot 再转发实时事件；按 Session id 单飞打开并共享
- [ ] `prompt`（空闲时 run）、`abort`、`response` 与错误码；`session_busy` 由 21 的错误码映射
- [ ] 新连接接管，旧连接以 `superseded` 关闭；WS 断开不中断 Run
- [ ] 接缝：进程内启动 server + 真实 WS 客户端 + `fakeModel`，`bun:test`
