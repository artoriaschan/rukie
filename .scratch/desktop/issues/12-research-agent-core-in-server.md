# 12: Agent Core 在 server 中的直接调用

Type: research

Blocked by: None

Status: resolved

## Question

`packages/server` 能否不经改造直接 import `@rukie/agent` 承载多项目、多 Session？哪些协调由 server 负责，哪些需要先改 Agent Core？

## Answer

依据：阅读 `packages/agent/src/index.ts`、`SessionOptions` 与 `Session` 接口（`packages/agent/src/session/index.ts:133-292`），并 grep 进程级全局与 frontend 依赖；未实际编写 server 调用验证。

- 可以直接使用：包入口为 `src/index.ts`、`workspace:*` 引用，无需构建；与 server 同为 Bun 运行时（ADR-0001）；源码不依赖 React、`@rukie/i18n` 或 coding-agent。
- 多项目：`cwd`、`homeDir` 按 Session 经 `SessionOptions` 显式传入，源码无 `process.cwd()`，单 sidecar 可并行打开多个项目的 Session。
- API 对应：`createSession`/`listSessions`/`loadSettings`/`listModels` 负责新建、恢复与列举；`run(prompt, { signal })` 接收 AbortSignal，对接 Effect 中断（见 [04](04-research-effect-on-bun.md#answer)）；`subscribe()` 先推已提交 snapshot 再推实时事件，支撑重连补发；`steer()`、`abort()`、`close()` 分别对应命令与 lease 释放。
- Interaction：`onPermissionAsk`、`onQuestion`、`onPlanReview`、`onMcpAuth` 是 `createSession` 时固定的 Promise 回调，省略即隐藏依赖工具。server 需提供桥接回调：挂起 Promise 存入 pending 表，转发给当前连接的客户端，重连后补发（与 [02](02-connection-and-process-semantics.md#answer) 一致）。`InteractionIdentity` 能否作为关联 ID 由 [10](10-wire-protocol-messages.md) 确认。
- server 负责：按 Session id 单飞打开并在多个客户端间共享同一 Session（见 [05](05-research-store-lease-concurrency.md#answer)）；传入 `onWarning` 接入 server 日志，默认 `console.warn` 写 stderr，不干扰 stdout 握手。
- 进程级全局：`tools/jobs/registry.ts:17` 的 `process.once("exit")` 在退出时清理所有 Background Job 进程组，多 Session 共享无冲突；SIGKILL 后的孤儿进程组问题同 05。
- 需先改 Agent Core：`Session already open` 改为带 code 的 user-visible error；`listSessions` 按目录容错。
- 编译产物中的 ripgrep 定位由 npm-release 02 先落地，sidecar 复用。
