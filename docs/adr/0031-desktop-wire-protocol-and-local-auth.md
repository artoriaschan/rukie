---
status: accepted
---

# 桌面端 wire 协议：单条 WebSocket 复用多个 Session，token 与 Origin 双重校验

## 问题

渲染进程要和本机 sidecar 交换 Session 事件、命令与 Interaction，还要在断连后恢复。sidecar 监听本机端口，同一台机器上的网页和其他进程也能尝试连接，需要明确协议形态与访问控制。

## 决定

连接：

- 每个窗口一条 WS，多个 Session 按 `sessionId` 复用，客户端显式订阅与退订。
- 订阅时 server 先发 snapshot，再补发挂起的 Interaction，然后转发实时事件。
- 只有一条活跃连接：新连接接管，旧连接以 `superseded` 关闭，挂起的 Interaction 转给新连接。
- 断连不结算 Interaction，Run 在 sidecar 中继续。

消息：

- 所有命令走 WS。客户端消息带 `id`，server 回 `response`，失败时带错误 `code`。不另开 HTTP API。
- 客户端命令以 TypeBox 定义在 `@rukie/shared`，由 server 校验。server 到客户端的消息只用 TS 类型：SessionEvent 原样转发，server 自有消息使用不冲突的 `type`。
- Interaction 直接以 `InteractionIdentity` 关联，pending 表以 `epoch` 为键；epoch 不匹配的回复返回 `interaction_stale`。
- Run 进行中的发送走 Queued Input，可以立即发送或撤回，停止时交还给客户端。
- Headless stream-json 不做破坏性修改。

访问控制：

- server 只监听 `127.0.0.1` 的随机端口，启动时生成一次性 token。
- token 经 WS subprotocol 传递：`["rukie.v1", "rukie.auth." + token]`，`rukie.v1` 排在首位，server 只回显它。
- 升级前的中间件精确校验 Host（`127.0.0.1:<port>`）、Origin 白名单与 token（恒定时间比较），任何一项失败都拒绝升级。
- 生产 Origin 是 Electron 自定义 scheme `app://rukie`。token 由 main 持有，经 preload 的 `getConnection()` 交给渲染进程，main 校验调用来自 `app://rukie`。
- 浏览器开发模式直连 sidecar，不经 Vite proxy。只在 sidecar 以开发标志启动时放行 Vite 地址，token 经 URL fragment 传入。

规划依据见[桌面端地图](../../.scratch/desktop/map.md)的 02、06、10 与 16。

## 备选方案

- 一个 Session 一条 WS：连接数随打开的 Session 增长，重连与接管要按 Session 逐条处理。
- 多客户端同时连接并合并状态：Interaction 回复与 Queued Input 会出现竞争，MVP 不需要。
- 另造 Interaction 关联 ID：`InteractionIdentity` 已经提供每次调用唯一的 epoch 和跨恢复稳定的 requestId。
- token 走 query 参数：会进入请求日志。走 cookie 交换：受 SameSite 限制，还要额外端点。
- 用 Hono `csrf()` 或由请求 URL 推导 Origin：前者跳过 GET（含 WS 升级），后者由攻击者可控的 Host 构造。
- `file://` 加载页面：所有本地页面的 Origin 都是 `file://`，无法区分。

## 影响

协议只有一条连接、一套命令通道，重连语义集中在订阅流程中。token 会出现在 DevTools 的请求头里。sidecar 重启后端口与 token 都会变，客户端每次重连都要重新获取。实施工单见[桌面端 spec](../../.scratch/desktop/spec.md)。
