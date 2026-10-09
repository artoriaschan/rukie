# 04: Effect 版本与 Bun、Hono 集成

Type: research

Blocked by: None

Status: resolved

## Question

当前应锁定哪个 Effect 版本（含 `@effect/platform-bun` 等配套包），它在 Bun 1.4.2 上是否稳定？Hono 路由和 WS handler 如何调用 Effect 程序（ManagedRuntime、Layer 注入、请求级 Scope、中断传播到 Agent Core 的 AbortSignal）？Effect 与 TypeBox 并存时，在校验后类型进入 Effect 层的推荐做法是什么？

## Answer

完整调研：[research/effect-on-bun.md](../research/effect-on-bun.md)。集成模式已在 Bun 1.4.2 + TypeScript 6.0.3 strict 下用临时脚本验证（未提交）。

- 版本：锁定 `effect` 4.0.2（2026-10-07 发布，无运行时依赖，4.x 为 LTS，修复支持至少到 2029-09）。server 用到的 `ManagedRuntime`、`Layer`、`Context.Service`、`Scope`、`FiberMap` 均为 stable。
- 暂不引入 `@effect/platform-bun`：`BunRuntime`/`BunHttpServer` 在 4.0.2 仍标记 unstable，HTTP/WS 由 Hono 承担；将来引入时与 `effect` 同版本锁定。不用 Effect 3.x 与 `@effect/platform` 0.97.x。
- 运行时：进程级单个 `ManagedRuntime`，Agent Core、store、Run registry 以 Layer 注入。
- HTTP：`runtime.runPromiseExit(Effect.scoped(program), { signal: c.req.raw.signal })`，显式把 Exit 映射为响应。
- 中断传播：Agent Core 调用包在 `Effect.promise((signal) => …)` 或 `Effect.tryPromise` 中，Fiber 中断即触发 AbortSignal；已验证客户端断开会 abort Agent Core。
- WS：`@hono/bun` 不提供连接生命周期 signal，Run 存在 server 级 `FiberMap<SessionId, …>`：WS 关闭不中断 Run（与 [02](02-connection-and-process-semantics.md#answer) 一致），abort 命令调用 `FiberMap.remove`，graceful shutdown 调用 `runtime.dispose()` 中断全部 Run；只有事件订阅随连接存亡。
- TypeBox 进入 Effect：TypeBox 仍是唯一 wire schema，Hono 以 `unknown` 经 `Value.Check`/`Value.Parse` 校验，Effect 服务直接接收 `Static<typeof X>`；需要类型化错误时用 `Effect.try` + `Data.TaggedError`。两者无内置桥接（TypeBox 1.3.27 不实现 Standard Schema）。
- 风险：4.0.x 刚发布一周、已有两个补丁（含中断竞态修复）；网上资料多为 3.x，以安装包 `.d.ts` 与内置文档为准；中断只有在 Agent Core 真正监听 AbortSignal 时生效；`onMessage` 里 `runFork` 的任务需显式错误处理；`Effect.abortSignal` 不能交给比 scope 活得久的 Run。
