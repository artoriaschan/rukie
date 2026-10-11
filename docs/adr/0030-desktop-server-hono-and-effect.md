---
status: accepted
---

# 桌面端 server 用 Hono 接入，Effect 只在 server 内部

## 问题

桌面端 server 要同时管理多个 Session 的 Run、挂起的 Interaction、WebSocket 订阅和进程关闭，涉及并发、中断与资源释放。仓库其余部分都不用 Effect，需要决定它用在哪里、止于哪里。

## 决定

Hono 负责 HTTP 与 WebSocket 接入：路由、中间件、请求校验与响应。Effect 4.0.2 负责 server 内的业务编排、依赖注入、类型化错误、并发任务与资源生命周期。

- 进程级只有一个 `ManagedRuntime`，Agent Core、桌面端注册表与 Run registry 以 Layer 注入。
- Agent Core 拥有 Run 与人类输入的完成记录；server 用 requestId 键控的 `FiberMap` 等待输入回执。WS 关闭只释放订阅，abort 调用 Session 并等待结算；这一资源归属部分由 [ADR-0033](0033-desktop-request-receipt-ownership.md) 替代原来的 Session-keyed Run Fiber 决定。
- 调用 Agent Core 时包在 `Effect.promise((signal) => …)` 或 `Effect.tryPromise` 中，Fiber 中断经 AbortSignal 传给 Agent Core。
- TypeBox 是唯一的 wire schema。Hono 把输入当作 `unknown` 校验，Effect 服务只接收校验后的 `Static` 类型。

Effect 不越过 server 边界：Agent Core 不迁移到 Effect，ui 与 desktop 不依赖 effect。暂不引入 `@effect/platform-bun`，因为它在 4.0.2 中仍标为 unstable。规划依据见[桌面端地图](../../.scratch/desktop/map.md)的 01 与 04。

## 备选方案

- server 全部用 Promise 加手写的取消与清理：并发 Run、订阅与关闭顺序需要大量手写状态，容易漏掉释放。
- 用 `@effect/platform-bun` 同时承担 HTTP 与 WS：4.0.2 中 `BunHttpServer` 仍是 unstable。
- 把 Agent Core 也迁到 Effect：与 [ADR-0024](0024-adopt-pi-durable-harness.md) 的 Harness 大面积交叉，另开 effort。

## 影响

server 是仓库里唯一使用 Effect 的包，贡献者需要了解 Effect 4。4.0.x 发布时间短，以安装包的类型声明与内置文档为准。中断只有在 Agent Core 真正监听 AbortSignal 时才生效。实施工单见[桌面端 spec](../../.scratch/desktop/spec.md)。
