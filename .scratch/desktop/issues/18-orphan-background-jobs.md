# 18: 孤儿 Background Job 的回收

Type: grilling

Blocked by: None

Status: resolved

## Question

sidecar 被 SIGKILL 或崩溃后，`detached` 的 Background Job 进程组成为孤儿，Resume 不回收（[05](05-research-store-lease-concurrency.md#answer)）。桌面端 MVP 是否需要 Agent Core 持久化 pgid 并在打开 Session 时回收，还是先依赖 graceful shutdown 并记为已知限制？若需要，回收时机与对 TUI 的影响如何？MVP 只支持 macOS（[03](03-mvp-scope.md#comments) 2026-10-10），可只考虑 POSIX 进程组语义。

## Answer

2026-10-10 grilling 定稿。事实依据：`packages/agent/src/tools/jobs/registry.ts`（`detached: true` 独立进程组；`process.once("exit")` 对存活进程组 SIGKILL；Session 关闭时 SIGTERM，3 秒后 SIGKILL）与 CONTEXT.md 的 Background Job 定义。

- 孤儿只在 sidecar 被 SIGKILL、崩溃或断电时产生；graceful 退出与 Session 关闭已经回收进程组。TUI 被 SIGKILL 时同样会留下孤儿，这是 Agent Core 的既有限制，不是桌面端特有的问题。
- MVP 不回收孤儿，记为 spec 的已知限制。Agent Core 不持久化 pgid，CONTEXT.md 中“Background Job 不持久化，Resume 后不存在”保持不变。不选持久化回收：只有崩溃路径受益，还要防 pid 复用误杀无关进程；也不由 sidecar 或 desktop main 记录 pgid，否则越过 ADR-0011 的能力所有权。
- desktop main 停止 sidecar（退出应用、无响应、崩溃后重启前）一律先 SIGTERM，等宽限期后再 SIGKILL。宽限期暂定 5 秒（Session 关闭最多等 3 秒，再留余量），具体值由 spec 定。
- sidecar 需像 `coding-agent/src/main.ts` 一样处理 SIGTERM：关闭所有打开的 Session，再退出。
- 崩溃重启后不提示可能遗留的 Background Job，只写进文档的已知限制。是否提示“sidecar 已重启”属于 02 的重启语义，不在本票。
- 18 不新增 Agent Core 前置改动；地图中“孤儿 Background Job 是否并入”一项可以关闭。
