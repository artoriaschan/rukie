# 研究：Session store 写者 lease 的并发打开

对应工单：[05](../issues/05-research-store-lease-concurrency.md)。基于 `main@39e1fb29` 源码、已安装的 `@earendil-works/pi-durable@1.0.4`，以及在 Bun 1.4.2（macOS）上的最小复现。

## 结论

- lease 的粒度是单个 Session 目录，不是项目。每次 `createSession` 在 `~/.rukie/durable-sessions/<sha256(cwd)>/<id>/host-lease.sqlite` 上用 `PRAGMA busy_timeout = 0; BEGIN IMMEDIATE;` 拿 SQLite RESERVED 锁，失败立即抛 `Session already open: <id>`，不等待、不排队（`packages/agent/src/store/index.ts:130-156`）。
- (a) 同一进程并发打开多个不同 Session 互不影响；同一进程第二次打开同一 id 被拒绝。
- (b) TUI 与 sidecar 打开同一项目的不同 Session 可以并存；打开同一 Session 时后到者立即失败，没有让出、抢占或交接协议。
- (c) 进程死亡由内核释放锁，下一个打开者无需清理即可接管，并由 JSONL 恢复和 Harness 原生恢复继续未结算工作；但宿主拥有的 Background Job 进程组会成为孤儿。
- Agent Core 只保证“一个 Session 一个写者”。同 id 的单飞打开与多客户端共享、busy 错误的类型化、跨进程列表的健壮性、崩溃后的进程收尾，以及 Session 之外的共享文件，都需要桌面 server 或 Agent Core 的后续改动来协调。

## lease 机制

- 上游不提供跨进程锁：“One process owns a storage at a time; there is no cross-process locking.”（`node_modules/@earendil-works/pi-durable/README.md:543`）。ADR-0024 因此要求“宿主保证重复打开被拒绝”（`docs/adr/0024-adopt-pi-durable-harness.md:27`），CONTEXT 将其定义为“宿主保证单个写者，关闭或进程退出释放租约”（`CONTEXT.md:89-90`）。
- 实现：lease 数据库不存 Session 记录，只用它的内核锁保护原生 JSONL。文件永不删除，避免第二个 owner 锁到另一个 inode（`packages/agent/src/store/index.ts:147-150`）。开启事务失败时关闭连接并抛出普通 `Error`（`:151-156`）。锁拿到后才执行 `JsonlStorage.open`（`:159`），所以恢复与截断只由 lease 持有者执行。
- 释放：`release()` 幂等，清理文件适配器后 `lease.close()`（`:164-172`）；`Session.close()` 在关闭 harness、MCP、jobs 之后最后释放 lease（`packages/agent/src/session/index.ts:3283-3323`）。打开失败路径也会释放（`:397-399`）。
- 父子 Conversation 和任务 ownership 存在同一 storage 中（`docs/adr/0024-adopt-pi-durable-harness.md:29`），所以子代理不需要单独 lease。
- 新建 Session 用 `crypto.randomUUID()` 作为 id（`packages/agent/src/store/index.ts:138`），新建之间不会冲突，只有 resume 同一 id 会冲突。

## (a) 同一进程并发打开多个 Session

- 不同 id 使用不同 lease 文件，互不影响。复现：同进程对文件 A 持锁时，对文件 B `BEGIN IMMEDIATE` 成功。
- 同一 id 的第二个连接即使在同进程内也会被拒绝：bun:sqlite 每个 `new Database` 都是独立连接，SQLite 在进程内按 inode 跟踪 POSIX 锁。复现输出 `same-process second connection same file: false SQLiteError: database is locked`；关闭第一个连接后可以重新获取。仓库测试覆盖同一行为：worker 进程持有时，测试进程内 `createSession({ resumeId })` 以 `Session already open:` 拒绝，且不调用模型（`packages/agent/tests/e2e/session-store-ownership.test.ts:84-87`）。
- 进程内另有一道保护：`registerSessionReader` 在同一 key 已注册时抛 `Session already open`（`packages/agent/src/store/index.ts:75-87`，在 `session/index.ts:2552` 注册）。实际执行时 lease 先拒绝。
- 进程级全局状态可以被多个 Session 共享：`liveReaders`（`store/index.ts:75`）、Background Job 的 `liveGroups` 与 exit 监听（`packages/agent/src/tools/jobs/registry.ts:16-19`），以及 pi-durable 的文件修改队列。修改队列按 `env.id + canonical path` 串行化 edit/write，`NodeExecutionEnv.id` 固定为 `"node:local"`（`pi-durable/dist/env/node.js:545`），所以同一 sidecar 内不同 Session 对同一文件的 edit/write 会排队；它明确“Not a lock against `bash` or other processes”（`pi-durable/dist/tools/file-mutation-queue.js:28-30`）。
- 打开必须由调用方单飞：同 id 的两个并发 `createSession` 必有一个失败，`SessionStore` 也没有“已打开则复用”的接口（`store/index.ts:70-74`）。

## (b) TUI 与桌面 sidecar 同时打开

- 同一项目、不同 Session：路径只由 cwd 哈希和 id 决定（`store/index.ts:131-134`），没有项目级锁，两边可以并存写入各自的目录。
- 同一 Session：后到者立即得到 `Session already open: <id>`。这是没有 `code` 的普通 `Error`（`store/index.ts:155`），不是 `createUserVisibleError`，也没有 i18n 文案；`packages/coding-agent/src` 中没有对它的专门处理（grep 无结果）。不存在请求对方释放、只读附着或强制接管的机制，持有者关闭或退出前，另一方只能看列表与摘要。
- 只读观察：持有者进程内，`list()` 借用已注册的活读者（`store/index.ts:191-195`）；其他进程冷读时，以只读文件系统打开原生 storage 内核，不启动 Harness 或任务恢复（`:197-207`，测试 `session-store-ownership.test.ts:88-96`、`:136-181` 验证文件字节不变）。
- 风险（代码推断，未复现）：跨进程冷读与对方的写入同时发生时，`list()` 可能整体失败。JSONL 打开时会执行 `recover`：删除 `.reclaim` 文件（`pi-durable/dist/storage/jsonl/storage.js:426-433`）、截断撕裂行（`:635-640`）和未确认的 sidecar 尾部（`:580-584`）。写者每次提交先追加 sidecar 再追加 main marker（`:185-199`），两者之间的窗口里冷读会看到未确认尾部；回收也会短暂产生 `.reclaim` 文件（`:393-413`）。只读代理把这些修改变成 `session-observation-readonly` 拒绝（`store/index.ts:89-121`），而 `list()` 的循环只有 `finally`，没有按目录 catch（`:199-226`），一个目录失败会让整个列表 reject。对 TUI 与 sidecar 同开同一项目的场景，这是可见故障。

## (c) sidecar 崩溃后的释放与接管

- 释放：锁属于 SQLite 连接的 POSIX 文件锁，进程死亡时内核释放，不需要 PID 文件或过期清理（`packages/agent/README.md` Session Store 第 2 段）。测试 SIGKILL 持有者后，两个竞争者同时打开，恰好一个 `READY`、一个 `REJECT`，并恢复已提交的消息，期间模型调用为 0，lease inode 不变（`session-store-ownership.test.ts:98-118`）；赢家关闭后第三方可以打开（`:119-126`）。
- 接管后的数据：`JsonlStorage.open` 截断撕裂行与未确认尾部，只采用已提交的事实（`storage.js:414-605`）。随后 Harness 原生恢复继续已接受但未结算的任务；仅双方都声明 safe 的工具调用会重跑，其余返回 interrupted（`docs/adr/0024-adopt-pi-durable-harness.md:21-23`）。未完成的审批、Plan Review、问题与 OAuth 按当前配置重新发起，进程退出不视为批准（`:37`）。
- 接管不分先后：谁先打开谁接管。如果 sidecar 自动重启（工单 02）之前 TUI 先打开了该 Session，重启后的 sidecar 会得到 `already open`。
- 进程挂起而未退出时，锁一直被持有。新 sidecar 无法打开这些 Session，必须先确认旧进程退出。
- 孤儿进程：Background Job 以 `detached: true` 创建独立进程组（`packages/agent/src/tools/jobs/registry.ts:109-117`），兜底只有 `process.once("exit")` 发送 SIGKILL（`:16-19`）。SIGKILL 或原生崩溃不会执行该监听，进程组会继续运行；它们不在 sidecar 的进程组中，结束 sidecar 进程组也影响不到它们。Resume 不恢复也不回收 OS 进程（`docs/adr/0024-adopt-pi-durable-harness.md:49`）。TUI 被 SIGKILL 时存在同样问题。

## Session 之外的跨进程共享状态

lease 只保护 Session 目录。以下文件由 TUI 与 sidecar 共享，各自只有进程内串行化：

- MCP 凭据：`writes` Map 在进程内排队，读-改-写后经临时文件 rename（`packages/agent/src/mcp/credentials.ts:59`、`:93-113`）。跨进程会丢失更新，但不会写坏文件。
- 模型能力缓存 `~/.rukie/model-capabilities.json`：进程内 `saving` 链，覆盖式写入整个 entries（`packages/agent/src/config/tool-capabilities.ts:70`、`:107-123`），跨进程后写者覆盖前写者。
- Checkpoint 备份清理：打开 Session 时删除其他 Session 中 mtime 超过 30 天的 `file-history/<id>`，只跳过当前 id（`packages/agent/src/checkpoint/cleanup.ts:17-31`，在 `session/index.ts:3329` 调用）。它不检查其他进程是否仍持有该 Session（边缘情况，长期打开且很久未产生备份时才会触发）。
- 工作区文件：不同进程的 Session 修改同一项目文件时，没有任何协调（`file-mutation-queue.js:28-30`）。

## 桌面端需要在 Agent Core 之外协调的事项

1. 按 Session id 单飞打开：server 维护 `id → Session | Promise<Session>`，并发请求与多个 WS 客户端共享同一个 Session 对象，订阅事件扇出，不重复调用 `createSession`。关闭以最后的显式关闭或窗口关闭为准（工单 02），并调用 `session.close()` 释放 lease。
2. busy 状态的类型化：需要 Agent Core 把 `Session already open` 改为带 code 的 user-visible error（`@rukie/shared` errors 和 zh/en 文案），wire 协议据此返回“已在其他位置打开”。不建议 server 匹配错误消息。UI 只提供只读摘要与重试，不提供强制接管：没有协议能让 TUI 释放，强制接管也违反单写者约束。
3. 列表健壮性：需要 Agent Core 让 `list()` 按目录容错（跳过或标记 busy/unreadable），否则 sidecar 的 Session 列表会被 TUI 的并发写入打断。修复归 store，不放在 server 中兜底。
4. 崩溃重启：desktop main 在重启前确认旧 sidecar 已退出（等待 exit，超时则 SIGKILL），避免挂起进程占住 lease；重启后的打开可能因 TUI 先打开而失败，此时按第 2 项展示。是否自动重新打开窗口中原先的 Session，由 spec 决定。
5. 孤儿 Background Job：Agent Core 目前无法在下次启动时回收被 SIGKILL 的 sidecar 留下的进程组。需要 spec 决定是否让 Agent Core 持久化 job pgid 并在打开时清理，还是接受该限制。desktop main 无法通过结束 sidecar 进程组覆盖这些进程。
6. 共享配置文件：多进程丢失更新目前没有 Session 级后果。若桌面引入凭据或设置写入界面，需要跨进程锁或合并写；MVP 不写设置时可以暂缓（工单 03 已把设置界面排除在外）。

## 验证记录

- 复现脚本（已删除）：同进程两个 `bun:sqlite` 连接对同一文件 `BEGIN IMMEDIATE`，第二个返回 `database is locked`；不同文件成功；关闭后可以重新获取。另一进程在持有期间获取失败，只读 `select 1` 成功。
- 未运行仓库测试套件。跨进程 `list()` 失败是代码推断，未复现。未验证 Windows 和 Linux 下的锁行为。
