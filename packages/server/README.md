# @rukie/server

Bun 本机 Frontend 通过带鉴权的 WebSocket 驱动 Agent Core。Session 与 TUI 共用 JSONL store，桌面项目注册表由本包维护。

## 使用

从包入口调用 `startServer({ homeDir })`，等待返回 `{ port, token, close }`。启动默认向 stdout 写一行 JSON `{port, token}`；诊断写 stderr。调用方负责在退出时等待 `close()`，释放 Run、Session lease 和 Background Job。进程入口是 [src/main.ts](src/main.ts)，处理 SIGTERM 和 SIGINT。

客户端连接 `ws://127.0.0.1:<port>/ws`，subprotocol 按顺序传入 `rukie.v1` 和 `rukie.auth.<token>`，Origin 必须是 `app://rukie`。`development: true`（进程入口的 `--dev`）额外接受 `http://localhost:5173`。随机端口绑定 loopback，鉴权失败在升级前返回 401 或 403。

## 行为与限制

[wire schema](../shared/src/wire.ts) 定义命令，`response` 关联客户端 `id`；订阅转发原始 SessionEvent，首条是 committed snapshot。新连接以 `superseded` 关闭旧连接，连接断开只移除订阅，Run 继续。`abort` 结算 Session 并移除 Effect FiberMap 中的 Run。单个 Session id 的并发恢复共享一次打开操作；跨进程持有的 lease 映射为 `session_busy`。

当前支持项目与 Session 列举、项目添加、首次发送创建、订阅与退订、空闲 prompt、abort。`session.create` 返回 `sessionId`，`abort` 返回撤回的 `inputs`。其余 schema 命令当前返回 `invalid_command`。权限 Interaction、Queued Input 操作及空闲回收由后续实现扩展。

注册表位于 `homeDir/.rukie/desktop/registry.json`，默认工作区位于同级 `workspace/`。注册表损坏阻止启动。列举一个工作目录失败时记录 warning 并继续其余目录；添加项目需要绝对目录。调用方只能通过服务命令修改注册表。

## 实现导航

[server.ts](src/server.ts) 持有 Hono 接入、单个 ManagedRuntime、Layer 与 Run FiberMap；[command.ts](src/command.ts) 在进入业务处理前校验不可信输入。依赖和架构约束见 [tech-stack](../../docs/tech-stack.md) 与 [ADR-0030](../../docs/adr/0030-desktop-server-hono-and-effect.md)。
