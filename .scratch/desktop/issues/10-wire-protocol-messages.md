# 10: wire 协议消息清单

Type: grilling

Blocked by: 05, 06

Status: resolved

## Question

在复用 SessionEvent 的前提下，客户端与 server 之间具体有哪些消息：项目与 Session 的列举、新建、恢复；run、steer、abort；Interaction 请求与响应的关联 ID；重连时的 snapshot 与挂起 Interaction 补发；多 Session 在单条 WS 上的复用还是一 Session 一连接？现有 stream-json 需要做哪些破坏性修改？Interaction 回调在 `createSession` 时固定，server 的桥接回调与 `InteractionIdentity` 是否足以作关联 ID，见 [12](12-research-agent-core-in-server.md#answer)。

## Answer

2026-10-10 grilling 定稿。事实依据：`packages/agent/src/session/events.ts`、`session/index.ts`（`run`/`steer`/`subscribe`）、`interaction/index.ts`、`store/index.ts`、`headless/main.ts`，以及 pi-durable 1.0.4 `harness/inbox.d.ts`、`submissions.d.ts`、`agent.js`。

连接

- 每个窗口一条 WS，多个 Session 按 `sessionId` 复用；客户端以 `session.subscribe` / `session.unsubscribe` 显式订阅。订阅时 server 先转发 `subscribe()` 的 snapshot，再补发该 Session 全部挂起的 Interaction，然后转发实时事件。
- 只有一条活跃连接：新连接接管，旧连接以 `superseded` 关闭，挂起的 Interaction 补发给新连接。不做多客户端合并。
- 所有命令走 WS：客户端消息带 `id`，server 回 `{type:"response", id, result}` 或 `{type:"response", id, error:{code, params?}}`。不另开 HTTP API。

消息与 schema

- server→客户端：SessionEvent 原样转发（每个变体已带 `sessionId`）；server 自有消息用不冲突的 `type`：`response`、`interaction_requested`（kind、`InteractionIdentity`、去掉 `signal` 的请求负载）、`interaction_settled`（identity 与结束原因：回复、取消、被会话规则覆盖）、`sessions_changed`。
- Headless stream-json 不做破坏性修改。
- 客户端命令是不可信输入，在 `@rukie/shared` 以 TypeBox 定义、server 校验；server→客户端消息保持 TS 类型。版本由 subprotocol `rukie.v1` 承载。

Interaction 关联

- 直接用 `InteractionIdentity`，不另造 ID：pending 表以 `epoch` 为键（每次调用唯一），客户端回复带回 identity，epoch 不匹配返回 `interaction_stale` 并丢弃。`requestId` 跨恢复稳定，UI 可识别同一提问重新出现。

发送、排队与停止

- `prompt {sessionId, text, images?}`：空闲时 `run`；运行中作为排队输入走原生 `followUp`，持久化在 Session inbox，崩溃与重连后从 snapshot 的 inbox 恢复。立即返回 `requestId`，完成以 `request_settled` 为准。
- 排队输入在当前 Run 的最终边界（模型不再调用工具）放入，不等后台 Subagent 或 Request 结算；保持默认 `followUpMode: "one-at-a-time"`，多条依次各自形成一次用户消息。
- `steer_now {sessionId, requestId}`：撤回该排队输入并以 steer 立即放入；`withdraw {sessionId, requestId}`：撤回。目标已放入对话时返回 `not_queued`。
- `abort {sessionId}`：原生 abort 撤回全部排队输入；server 在结果中带回原文与附件，UI 按排队顺序以空行合并，放在输入框现有草稿之前。

Session、项目与生命周期

- 新建：`session.create {project, text, images?}` 一步创建并发送首条消息，返回 `sessionId` 与 `requestId`，不产生空 Session。恢复不单独成命令：`session.subscribe` 时 server 由注册表查 cwd 并单飞打开。
- 项目、置顶与“对话”默认工作区由桌面端自有注册表（`~/.rukie/` 下桌面专属文件）维护，Agent Core 与 store 格式不变；列举时对每个注册 cwd 调 `listSessions`。默认工作区目录位置留给 spec。
- 其余 MVP 命令：`projects.list`、`sessions.list`、`project.add {path}`（仅接收 desktop 经系统文件夹选择框得到的绝对路径）、`session.pin` / `session.unpin`、`models.list`、`session.set_model`、`session.set_permission_mode`、`interaction.reply {identity, reply}`。不做重命名、Rewind、Plan Mode。
- 关闭：Session 有 Run、挂起 Interaction、排队输入或运行中 Background Job 时保持打开；空闲且无订阅超过宽限期才 `close()` 释放 lease。连接断开不触发关闭。宽限期时长留给 spec。

错误码（初始）

`session_busy`（lease 在别的进程，如 TUI）、`session_not_found`、`project_not_found`、`invalid_command`、`not_queued`、`interaction_stale`、`internal`。客户端按 code 显示 zh/en 文案；Run 内错误仍走 SessionEvent 的 `result` / `error`。

Agent Core 前置改动（并入桌面端前置工单）

- `Session already open` 改为带 code 的错误，供 `session_busy` 映射。
- `listSessions` 按目录容错。
- 公开排队输入：`followUp(prompt, {images?})` 返回 `requestId`；按 `requestId` 撤回（基于 pi `submissions.abort`），撤回与 abort 的结果带原文与附件。
