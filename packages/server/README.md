# @rukie/server

Bun 本机 Frontend 通过带鉴权的 WebSocket 驱动 Agent Core。Session 与 TUI 共用 JSONL store，桌面项目注册表由本包维护。

## 使用

从包入口调用 `startServer({ homeDir })`，等待返回 `{ port, token, close }`。启动默认向 stdout 写一行 JSON `{port, token}`；诊断写 stderr。调用方负责在退出时等待 `close()`，释放 Run、Session lease 和 Background Job。进程入口是 [src/main.ts](src/main.ts)，处理 SIGTERM 和 SIGINT。

客户端连接 `ws://127.0.0.1:<port>/ws`，subprotocol 按顺序传入 `rukie.v1` 和 `rukie.auth.<token>`，Origin 必须是 `app://rukie`。`development: true`（进程入口的 `--dev`）额外接受 `http://localhost:5173`。随机端口绑定 loopback，鉴权失败在升级前返回 401 或 403。

## 行为与限制

[wire schema](../shared/src/wire.ts) 定义命令，`response` 关联客户端 `id`；订阅转发原始 SessionEvent，首条是 committed snapshot。新连接以 `superseded` 关闭旧连接，连接断开只移除订阅，Run 继续。`abort` 结算当前 Run，并交还尚未放入的输入。单个 Session id 的并发恢复共享一次打开操作；跨进程持有的 lease 映射为 `session_busy`。

所有 [wire schema](../shared/src/wire.ts) 命令均通过 WS 提供。`session.create` 可带 `modelSelection`（provider、modelId、thinkingLevel）与 `permissionMode`，在首条输入前应用。它返回 `{ sessionId, requestId }`，`prompt` 返回 `{ requestId }`；空闲发送立即开始 Run，运行中发送使用 Agent Core 的 Queued Input。`withdraw` 返回 `{ input }`，`steer_now` 返回 `{ status: "steered" }`，两者无法操作已放入的输入时返回 `not_queued`；`abort` 返回 `{ inputs }`，保留原文、附件与排队顺序。

权限请求发送 `interaction_requested`（`sessionId`、原生 `identity`、去掉 signal 的 `request`）。回复核对完整 identity 和 epoch；旧回复返回 `interaction_stale`。回复、取消或会话规则覆盖都会发送 `interaction_settled`。订阅先收到 snapshot，再补发挂起请求；接管新连接后同样可以订阅并补发。

`models.list` 读取本地模型目录与凭据配置，不刷新或启动 OAuth。订阅和状态更新还提供 `session_state`（permissionMode、thinkingLevel、contextReport），不修改原始 SessionEvent。模型切换要求 Session 空闲，权限模式对下一次工具调用生效。置顶与侧栏偏好写入注册表；首次连接和这些修改发送 `sessions_changed`，携带 `sessions`、`projects`、`pinned` 与 `preferences`。

跨进程持有 lease 的 Session 可通过 Agent Core 的只读快照显示已提交 Transcript，然后返回 `session_busy`。只读访问不恢复任务、调用 Hooks 或写入 storage，不提供实时事件、权限回复与写命令；重新订阅可重试打开。快照保留消息、原生工具状态、排队输入、Run Summaries 与 Todo/Plan/Goal/子代理目录；不重建别的进程的 Background Job 或子代理活动。

无订阅且没有 Run、挂起权限请求、Queued Input、运行中 Background Job 或子代理的 Session，在持续空闲 10 分钟后关闭并释放 lease。进程收到 SIGTERM/SIGINT，先等待全部 Session abort，再释放 Effect runtime 和 Session、Job 进程组；调用方应等待 close 完成。SIGKILL 无法执行这些清理，孤儿 Job 不回收。

注册表位于 `homeDir/.rukie/desktop/registry.json`，默认工作区位于同级 `workspace/`。注册表损坏阻止启动。列举一个工作目录失败时记录 warning 并继续其余目录；添加项目需要绝对目录。调用方只能通过服务命令修改注册表。

## 实现导航

[server.ts](src/server.ts) 持有 Hono 接入、单个 ManagedRuntime、Layer 与 Run FiberMap；[command.ts](src/command.ts) 在进入业务处理前校验不可信输入。依赖和架构约束见 [tech-stack](../../docs/tech-stack.md) 与 [ADR-0030](../../docs/adr/0030-desktop-server-hono-and-effect.md)。
