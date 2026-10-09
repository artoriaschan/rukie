# 05: Session store 写者 lease 的并发打开

Type: research

Blocked by: None

Status: resolved

## Question

ADR-0024 的 `bun:sqlite` 宿主写者 lease 在以下情形如何表现：同一 sidecar 进程内并发打开多个 Session；TUI 与桌面 sidecar 同时打开同一项目或同一 Session；sidecar 崩溃后 lease 如何释放与接管？桌面端需要在 Agent Core 之外做什么协调？

## Answer

完整调研：[research/store-lease-concurrency.md](../research/store-lease-concurrency.md)。基于 `main@39e1fb29` 与 `@earendil-works/pi-durable@1.0.4`，锁行为在 Bun 1.4.2（macOS）上最小复现。

- 粒度：lease 按单个 Session 目录（`host-lease.sqlite`，`busy_timeout = 0` + `BEGIN IMMEDIATE`），不按项目；失败立即抛 `Session already open: <id>`，不等待。
- (a) 同进程：不同 Session 互不影响；同 id 第二次打开即使在同进程也被拒绝，`SessionStore` 没有“已打开则复用”接口。
- (b) TUI 与 sidecar：同项目不同 Session 可并存；同一 Session 后到者立即失败，无让出、只读附着或接管协议。该错误是无 code 的普通 `Error`，没有 i18n 文案。
- (c) 崩溃：内核释放锁，先打开者接管，JSONL 恢复与 Harness 原生恢复继续已提交工作；挂起未退出的进程会一直占住 lease；`detached` 的 Background Job 进程组在 SIGKILL 后成为孤儿，Resume 不回收。
- 风险（代码推断，未复现）：跨进程冷读 `list()` 遇到对方写入窗口时会因只读拒绝而整体 reject，没有按目录容错。
- Session 外共享文件（MCP 凭据、`model-capabilities.json`、checkpoint 清理）只有进程内串行化，跨进程可能丢失更新；MVP 不写设置时可暂缓。
- 桌面端需协调：server 按 Session id 单飞打开并在多 WS 客户端间共享同一 Session；Agent Core 把 busy 改为带 code 的 user-visible error、让 `list()` 按目录容错；desktop main 重启前确认旧 sidecar 已退出；孤儿 Background Job 是否由 Agent Core 持久化 pgid 并在打开时回收，由 spec 决定。
