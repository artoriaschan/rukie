# 研究：Effect 版本与 Bun、Hono 集成

回答工单 [04](../issues/04-research-effect-on-bun.md)。调研日期 2026-10-09，本机 Bun 1.4.2。结论来自 npm registry、Effect 官方仓库与网站，以及已安装包的类型声明和源码；“验证”一栏指在临时目录用精确版本跑过的 spike（见文末）。

## 结论

- 锁定 `effect` 4.0.2。server 只用核心包的 `ManagedRuntime`、`Layer`、`Context.Service`、`Scope`、`FiberMap`，这些在 4.0.2 都标 `@stability stable`。
- 暂不引入 `@effect/platform-bun`。HTTP 与 WS 由 Hono + `@hono/bun` 承担（ADR-0001、[01](../issues/01-packages-and-effect-boundary.md)），platform-bun 的 `BunRuntime`、`BunHttpServer` 在 4.0.2 仍是 `@stability unstable`，并带入 `@effect/platform-node-shared`。若以后需要 `BunRuntime.runMain` 的信号处理再引入，版本必须与 `effect` 相同（4.0.2）。
- 不选 Effect 3.x（3.22.2）。3.x 已进入维护分支，4.x 是 LTS。
- Hono 路由用一个进程级 `ManagedRuntime` 执行 Effect 程序，把 `c.req.raw.signal` 传给 `runPromise*` 的 `signal` 选项；Effect 侧用 `Effect.promise((signal) => …)` 或 `Effect.tryPromise` 把 fiber 的中断转成传给 Agent Core 的 `AbortSignal`。
- WS 上的 Run 不能挂在连接或消息的生命周期上（02：断连时 Run 继续）。Run fiber 放进 runtime Layer 持有的 `FiberMap<SessionId, …>`；abort 命令调用 `FiberMap.remove`，graceful shutdown 调用 `runtime.dispose()`。
- TypeBox 继续作为 wire 协议的唯一 schema：Hono 边界用 `Value.Check`/`Value.Parse` 校验，Effect service 的参数直接用 `Static<typeof X>` 类型，不在 Effect 层用 Effect Schema 再定义或再解码一遍。

## 版本

| 包                     | 建议锁定             | 发布时间（UTC）    | 依据                                                                                                    |
| ---------------------- | -------------------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| `effect`               | 4.0.2                | 2026-10-07         | npm `latest`；4.0.0 发布于 2026-10-01，4.0.1 于 2026-10-05                                              |
| `@effect/platform-bun` | 不引入（如需 4.0.2） | 2026-10-07         | npm `latest`；peer `effect ^4.0.2`，依赖 `@effect/platform-node-shared ^4.0.2`                          |
| `@effect/platform`     | 不使用               | 0.97.2，2026-09-09 | 只属于 Effect 3 生态；4.x 把 platform 能力并入 `effect` 本身（`effect/http`、`effect/socket` 等子路径） |
| `hono`                 | 维持 4.13.12         | 2026-09-30         | 当前 `latest` 为 4.13.13（2026-10-04），不是本工单范围，升级与否另议                                    |
| `@hono/bun`            | 维持 1.0.0           | —                  | peer `hono >=4.13.9`                                                                                    |
| `typebox`              | 维持 1.3.27          | —                  | 跟随 pi，见 tech-stack                                                                                  |

要点：

- `effect` 4.0.2 的 `package.json` 没有 `dependencies`（零运行时依赖），这点也写在 4.0 发布公告里。[npm `effect@4.0.2`](https://www.npmjs.com/package/effect/v/4.0.2)、[Effect 4.0 公告](https://effect.website/blog/releases/effect/40/)
- 4.x 起所有 `@effect/*` 包同版本、同步发布（公告 “The packages around it share a single version and release in lockstep”）。引入任何 `@effect/*` 时都与 `effect` 精确同版本。
- 官方 README（2026-10-09 读取）：Effect 4.x 是 LTS，至少三年 bug 与安全修复；stable API 只在 major 版本里做破坏性修改，`unstable` 可在 minor 变，`experimental` 可在 patch 变。要求 TypeScript ≥ 5.9 且开启 `strict`，仓库的 TypeScript 6.0.3 与 strict 配置满足。[Effect-TS/effect README](https://github.com/Effect-TS/effect/blob/main/README.md)
- 公告给出的 LTS 时间：bug 与安全修复至少到 2029 年 9 月。
- 4.0.x 是刚发布的 major，一周内已有两个 patch（4.0.2 release notes 修了 `Cache.get` 中断竞态等）。[effect@4.0.2 release](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.2)。按仓库惯例精确锁定，升级随 tech-stack 更新。

## Bun 1.4.2 上的稳定性

- `effect` 核心是纯 TypeScript，不依赖 Node 内置模块；README 只给出 Node ≥ 18 的一般要求，没有单独的 Bun 支持声明。`@effect/platform-bun` 4.0.2 的 devDependency 是 `@types/bun ^1.4.2`，说明官方按 Bun 1.4 系列构建该包。
- 在 Bun 1.4.2 上实测（spike）：`ManagedRuntime`、`Layer`、`FiberMap`、`Effect.promise` 的 signal、`RunOptions.signal`、`runtime.dispose()` 全部按文档行为工作，`tsc`（TypeScript 6.0.3、strict）零错误。
- 已知未关闭的 Bun 相关 issue 都在本方案不使用的模块上（2026-10-09 查询 [open issues “bun”](https://github.com/Effect-TS/effect/issues?q=is%3Aopen+bun)）：
  - [#6037](https://github.com/Effect-TS/effect/issues/6037)：`BunHttpServer` 上的 WebSocket RPC 打印 “HTTP 499 / All fibers interrupted”（报告于 Effect 3.19.15、Bun 1.3.8）。
  - [#8635](https://github.com/Effect-TS/effect/issues/8635)：`BrowserWorkerRunner` 在 Bun 下 finalizer 抛错。
  - [#5930](https://github.com/Effect-TS/effect/issues/5930)：Bun SQLite 多语句执行。
  - [#6155](https://github.com/Effect-TS/effect/issues/6155)：`@effect/cluster` 配合 `BunClusterSocket`。
  - 这些进一步支持“不用 platform-bun 的 HTTP/WS 栈，留给 Hono”。

## Hono 调用 Effect 程序

### 官方模式

Effect 4.0.2 包内附带的 `ai-docs/src/04_integration/10_managed-runtime.ts` 正是 “Using ManagedRuntime with Hono”：模块级 `ManagedRuntime.make(layer, { memoMap })`，handler 里 `await runtime.runPromise(...)`，进程收到 `SIGINT`/`SIGTERM` 时 `runtime.dispose()`。官网 [Runtime › Integrations](https://effect.website/docs/runtime/) 给出同样的模式（“Effect is not the primary framework”）。

`ManagedRuntime.make` 的类型文档（`effect/dist/ManagedRuntime.d.ts`）：Layer 在第一次使用时惰性构建并缓存 context；Layer 获取的资源归 runtime 所有，`dispose`/`disposeEffect` 时释放；dispose 之后 runtime 不能复用。runtime 还提供 `runPromiseExit`、`runFork`、`runCallback` 与 `Symbol.asyncDispose`。

### Layer 注入

- 用 `Context.Service` 定义服务（4.x 写法，取代 3.x 的 `Context.Tag`/`Effect.Tag`），`static layer` 用 `Layer.succeed`/`Layer.effect` 构建。
- server 进程只建一个 runtime：`ManagedRuntime.make(Layer.mergeAll(AgentCoreLive, RunRegistryLive, …))`。Agent Core 的 Session 句柄、store、lease 都作为 Layer 内资源（`Effect.acquireRelease`）注入，dispose 时按逆序释放。
- 只有一个 runtime 时不需要共享 `memoMap`；以后若出现多个 runtime 共享 Layer，再用 `Layer.makeMemoMapUnsafe()`（官方示例做法）。
- Hono 的 `Context` 不传进 Effect。handler 先完成 token/Origin/Host 中间件与 TypeBox 校验，再把纯数据交给 Effect 程序。

### 请求级 Scope 与中断

- `RunOptions`（`effect/dist/Effect.d.ts`，4.0.0 起）有 `signal?: AbortSignal`：“`signal` interrupts the fiber”。HTTP handler 传 `{ signal: c.req.raw.signal }`，客户端断开时 fiber 被中断。
- 把中断交给 Agent Core 的两个原语：
  - `Effect.promise((signal) => …)` / `Effect.tryPromise({ try: (signal) => …, catch })`：fiber 被中断时 abort 这个 signal。文档提醒 “the underlying asynchronous operation only stops if it observes that signal”，Agent Core 必须真正响应它（`Session` 已有 `signal`/`withAbortSignal` 路径）。
  - `Effect.abortSignal`（4.0.0 起，`Effect<AbortSignal, never, Scope>`）：Scope 关闭时 abort。用于需要在一个 Scope 内多处共用同一 signal 的场景，配合 `Effect.scoped` 形成请求级 Scope。
- 请求级 Scope 就是 `Effect.scoped(program)`：handler 里 `runtime.runPromiseExit(Effect.scoped(program), { signal })`。fiber 结束、失败或中断时 Scope 关闭，`acquireRelease`/`addFinalizer` 的资源随之释放。
- 用 `runPromiseExit` 而不是 `runPromise`，在 Hono 侧按 `Exit` 显式映射：成功 → 2xx，typed error（`Data.TaggedError`）→ 4xx/5xx，中断 → 不再写响应或返回 503。避免把 Effect 的 reject 变成 Hono 的 500。

### WebSocket

`@hono/bun` 1.0.0 的 `upgradeWebSocket` 只把 `onOpen`/`onMessage`/`onClose` 回调转发给 Bun 的 `websocket` handler（`dist/websocket.js`），不提供任何生命周期 signal。按 [02](../issues/02-connection-and-process-semantics.md) 的语义：

- Run 的生命周期属于 Session，不属于 WS 连接。runtime Layer 持有一个 `FiberMap<SessionId, RunResult>`（`FiberMap.make` 需要 `Scope`，放在 `Layer.effect` 里即由 runtime 的 Scope 拥有）。
- `run` 命令：`runtime.runFork(FiberMap.run(runs, sessionId, startRun(cmd)))`。WS 关闭不影响这个 fiber。
- `abort` 命令：`FiberMap.remove(runs, sessionId)` 中断 fiber → Agent Core 的 signal 被 abort。
- 连接级订阅（把 SessionEvent 推给这个 socket）才是连接作用域的资源：`onOpen` 时 `runFork` 一个订阅 fiber 并保存，`onClose` 时 `Fiber.interrupt`。重连补发 snapshot 由新连接的订阅 fiber 负责。
- graceful shutdown：`await runtime.dispose()` 关闭 runtime Scope → FiberMap 中断所有 Run → Agent Core 收到 abort，然后 `server.stop()`。超时 kill 由 desktop main 负责（02）。

### Spike 结果（Bun 1.4.2，effect 4.0.2，hono 4.13.12，@hono/bun 1.0.0，typebox 1.3.27）

| 场景                                                                   | 观察                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| HTTP 客户端中途断开，`runPromiseExit(…, { signal: c.req.raw.signal })` | fiber 中断，`Effect.promise` 给的 signal abort，假 Agent Core 收到 abort |
| WS 发起 Run 后关闭 socket，Run 在 `FiberMap` 中                        | Run 正常完成，未被中断                                                   |
| WS `abort` 命令 → `FiberMap.remove`                                    | fiber 中断，Agent Core 收到 abort                                        |
| Run 进行中 `runtime.dispose()`                                         | FiberMap 中断全部 Run，Agent Core 收到 abort                             |
| `Schema.declare` 包装 `Value.Check`                                    | 可行（见下节，不推荐作为默认）                                           |

第一项证明 Bun 1.4.2 在 TCP 断开时会 abort `Request.signal`，这是唯一需要真实时间的行为；server 测试应保留一个这样的真实连接用例，其余逻辑用 Effect 的 `TestClock` 或直接驱动 FiberMap。

## TypeBox 校验后的值进入 Effect 层

推荐：TypeBox 是 wire 协议的唯一来源，Effect 层只接收 `Static<typeof Schema>`。

- 边界（Hono handler、WS `onMessage`）把输入当 `unknown`，用 `Value.Check` 收窄或 `Value.Parse` 解析，失败在 Hono 侧回 400 或 WS error 消息，不进 Effect。这符合仓库 “untrusted 输入按 unknown 解析” 的规则，也符合 01 “Effect 层只接收校验后的类型”。
- Effect service 签名直接用 TypeBox 推导的类型，例如 `run(cmd: Static<typeof RunCommand>) => Effect<…>`。类型由 `@rukie/shared` 导出，ui 与 server 共用，避免两套 schema 漂移。
- 不在 Effect 层再用 Effect Schema 声明同一个协议，也不对已校验的值重复 decode。Effect Schema 只在 server 内部、非 wire 的数据上按需使用（如内部配置）；即使用，也不跨出 server。
- 如果确有必要让 TypeBox 校验在 Effect 管道内发生（比如校验失败需要成为 typed error 参与 `catchTag`），写一个小桥：`Effect.try` 或 `Effect.suspend` 包 `Value.Check`，失败时 `Effect.fail(new InvalidCommand({ errors }))`（`Data.TaggedError`）。`Schema.declare((u): u is T => Value.Check(S, u))` 也可行，但它会把 TypeBox 校验包进 Effect Schema 的 issue 体系，诊断信息被压成单一 “Expected …”，只在需要组合 Effect Schema 时才值得用。
- 互操作的公共协议是 Standard Schema：`effect` 4.0.2 提供 `Schema.toStandardSchemaV1`（Effect → Standard Schema），未提供从 Standard Schema 构造 Effect Schema 的 API；已安装的 typebox 1.3.27 构建产物中没有 `~standard` 实现。因此两者之间没有官方零成本桥，上述“TypeBox 唯一来源”的分工是代价最低的做法。
- 版本约束不变：依赖树中只能有一份 `typebox`（tech-stack 规定跟随 pi 的 1.3.27）。`effect` 4.0.2 零依赖，不会引入第二份 typebox 或其它 schema 库。

## 风险

- 4.0.x 刚发布一周，patch 频率高；stable API 承诺不变，但需要关注 patch 中与中断、Scope 相关的修复。精确锁定并在升级时读 release notes。
- 4.x 的 API 与网上大量 3.x 资料不同（`Context.Service`、`Effect.promise` 的 signal、`RunOptions` 都是 4.0 新增或改名）。实现时以已安装包的 `.d.ts` 与包内 `ai-docs/`、`AGENTS.md` 为准，官网 docs 部分页面仍是 3.x 写法（Runtime 页示例用的是 `Effect.Tag`）。
- 中断依赖 Agent Core 真的响应 `AbortSignal`；`Effect.promise` 只负责 abort，不会强行停止 Promise。Agent Core 中未接 signal 的路径会在 Effect 侧看起来已中断而底层仍在跑。
- `onMessage` 里用 `runFork` 是 fire-and-forget：fiber 内的失败必须在 Effect 侧处理并以 WS 消息回给客户端，否则只会被 runtime 记录。
- `Effect.abortSignal` 在 Scope 关闭时 abort；不能把它交给生命周期超出该 Scope 的 Run（应使用 FiberMap 中 Run fiber 自己的 `Effect.promise` signal）。
- 若日后改用 `@effect/platform-bun` 的 `BunHttpServer` 承载 WS，需要先复核 [#6037](https://github.com/Effect-TS/effect/issues/6037)，并为 ADR-0001 中 Hono 的定位开新 ADR。

## 来源

- npm registry（2026-10-09 查询 `npm view … dist-tags/time/dependencies`）：`effect`、`@effect/platform-bun`、`@effect/platform`、`hono`、`typebox`。
- [Effect 4.0 发布公告](https://effect.website/blog/releases/effect/40/)：零依赖、lockstep 版本、LTS 到 2029-09，部分模块仍为 unstable/experimental。
- [Effect-TS/effect README](https://github.com/Effect-TS/effect/blob/main/README.md)：LTS 承诺、稳定性分级、TypeScript ≥ 5.9 与 strict 要求、v3 分支。
- [effect@4.0.2 release notes](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.2)，2026-10-07。
- [Effect docs: Runtime](https://effect.website/docs/runtime/)：ManagedRuntime 与外部框架集成。
- `effect@4.0.2` 包内：`ai-docs/src/04_integration/10_managed-runtime.ts`（Hono 集成示例）、`dist/ManagedRuntime.d.ts`、`dist/Effect.d.ts`（`RunOptions.signal`、`Effect.promise`、`Effect.abortSignal`、`Effect.scoped`）、`dist/FiberMap.d.ts`、`dist/Schema.d.ts`（`toStandardSchemaV1`、`declare`）及各模块 `@stability` 标注。
- `@effect/platform-bun@4.0.2` 包内 `package.json` 与 `dist/BunRuntime.d.ts`、`dist/BunHttpServer.d.ts` 的 `@stability unstable` 标注。
- `@hono/bun@1.0.0` 包内 `dist/websocket.js`。
- Effect open issues：[#6037](https://github.com/Effect-TS/effect/issues/6037)、[#8635](https://github.com/Effect-TS/effect/issues/8635)、[#5930](https://github.com/Effect-TS/effect/issues/5930)、[#6155](https://github.com/Effect-TS/effect/issues/6155)。
- Spike：临时目录用 `bun add --exact effect@4.0.2 @effect/platform-bun@4.0.2 hono@4.13.12 @hono/bun@1.0.0 typebox@1.3.27`，Bun 1.4.2 运行并通过 TypeScript 6.0.3 strict 检查；未提交到仓库。
