# 18: 孤儿 Background Job 的回收

Type: grilling

Blocked by: None

Status: needs-triage

## Question

sidecar 被 SIGKILL 或崩溃后，`detached` 的 Background Job 进程组成为孤儿，Resume 不回收（[05](05-research-store-lease-concurrency.md#answer)）。桌面端 MVP 是否需要 Agent Core 持久化 pgid 并在打开 Session 时回收，还是先依赖 graceful shutdown 并记为已知限制？若需要，回收时机与对 TUI 的影响如何？MVP 只支持 macOS（[03](03-mvp-scope.md#comments) 2026-10-10），可只考虑 POSIX 进程组语义。
