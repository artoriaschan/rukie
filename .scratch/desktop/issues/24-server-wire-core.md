# 24: server 鉴权握手、订阅与流式对话

**What to build:** 可端到端运行的最小 server：随机端口与 stdout 握手、WS 鉴权、项目与 Session 列举、新建与订阅、发送、abort，SessionEvent 原样转发。见 [spec](../spec.md) 的「server」「wire 协议与鉴权」与 [ADR-0030](../../../docs/adr/0030-desktop-server-hono-and-effect.md)、[ADR-0031](../../../docs/adr/0031-desktop-wire-protocol-and-local-auth.md)、[ADR-0032](../../../docs/adr/0032-desktop-shares-jsonl-store.md)。

Blocked by: 21, 23

Status: claimed

- [x] 只监听 `127.0.0.1` 随机端口，stdout 输出 `{port, token}`；Host、Origin、token 任一不符都拒绝升级，`rukie.v1` 为回显的 subprotocol
- [x] 开发标志下额外放行 Vite 地址，非开发模式拒绝
- [x] 桌面端注册表 `homeDir/.rukie/desktop/registry.json`：`projects.list`、`project.add`、默认工作区目录首次使用时创建
- [x] `sessions.list` 汇总各注册 cwd，单个目录失败不影响其余
- [x] `session.create` 一步创建并发送首条消息；`session.subscribe` 先发 snapshot 再转发实时事件；按 Session id 单飞打开并共享
- [x] `prompt`（空闲时 run）、`abort`、`response` 与错误码；`session_busy` 由 21 的错误码映射
- [x] 新连接接管，旧连接以 `superseded` 关闭；WS 断开不中断 Run
- [x] 接缝：进程内启动 server + 真实 WS 客户端 + `fakeModel`，`bun:test`

## Implementation evidence

- `startServer` exports a loopback Hono listener, stdout handshake, one Effect ManagedRuntime with Agent Core / registry / Run Layers, and server-owned FiberMap. `src/main.ts` handles SIGTERM/SIGINT.
- Real WS acceptance uses isolated homeDir and fakeModel; auth, persisted project registry, new Session/live events, snapshot-first takeover, missing/invalid commands, disconnected Run retention and abort covered.
- Red: initial public server test failed because startServer did not exist. Green: `bun test packages/server/tests` passes 8 tests, 26 assertions (~287 ms). Every added case runs below 1 second.
- `bun run check:dev` passed including TypeScript, Knip, docs, test policy and package boundary checks. No full suite run.
- ADR coverage: follows 0029–0032 without changing decisions. Permission/queued-input/idle lifecycle are issue25. Current session.create response has sessionId; requestId responses are explicitly pending issue25.
- Status remains claimed pending integration review and final acceptance.
