# 02: 原生 SQLite Session 存储与只读接口

**What to build:** 按[存储调整规格](../spec.md)和 [ADR-0035](../../../docs/adr/0035-desktop-isolated-sqlite-storage.md) 实施本票能力。

Blocked by: 01

Status: resolved

- [x] 检查锁定 pi-durable SqliteDatabase/Storage 接口，以 bun:sqlite 实现事务排队、回滚/关闭与 WAL/FULL；逐独立根 Session/Harness 原生 storage，子代理仍属于根 Harness
- [x] 更新 SessionStore 的 create/resume/list/key 与 JSONL 硬编码只读 storage/snapshot 调用，覆盖 subagent、恢复与清理全部消费者
- [x] 保留跨进程单执行者 lease，busy snapshot 读取一致已提交帧且不 repair/recover 或执行 schema migration；索引只发现本根 Session
- [x] 真实 Session/fake model 与真实子进程验证 crash、resume、只读、lease、空闲关闭；TUI 默认 JSONL 回归与 focused 性能证据

## Implementation Evidence

专用新子代理与独立分支 `feat/desktop-storage-02`，工作目录由 integration `feat/desktop-storage` 的 `7eb1d8b2` 创建。本票保持 claimed，等待主代理 review、集成与06最终验收。公开 seam 沿规格授权：`createSession` / fake model、`listSessions`、`readSessionStorage` / snapshot、真实跨进程 lease；portable database facade 是03/04可复用的已锁定原生 backend 接缝。

### 实现与失败证据

- 第一个真实 Session tracer 在修正前失败：未创建 `sessions/<id>/session.sqlite`。默认 backend 随显式 `dataRoot` 选择 SQLite，终端继续 JSONL。根 Harness 保存父子 Conversation、documents、tasks；没有新调度、子代理存储、旧目录导入或 fallback。
- `openBunSqliteDatabase` 使用 bun:sqlite、WAL/FULL；异步事务隔离并排队 unrelated 操作，回滚保留 callback error，回滚失败用 AggregateError，事务 handle 失效，close 在已接受操作后关闭。数据库写入不吞错；原生 SqliteStorage 拥有提交和恢复。
- Session lease 仍由独立永久 inode 的 SQLite kernel reservation保护，WAL不替代执行独占。SQLite重复 owner、SIGKILL后双 contender只有一个成功、第三 owner拒绝、关闭后重开，与JSONL同一真实子进程行为合同通过。
- 更新 create/resume/list/key 与 readonly snapshot 默认选择；SQLite先校验目标metadata再进入 Harness，拒绝其他cwd归属。`discoverSqliteSessions`只读扫描应用根已提交metadata并返回cwd，给03恢复丢失应用索引，不依赖注册项目、不扫描终端目录。
- readonly连接持有BEGIN的WAL读取帧；callback跨异步owner提交仍读原帧。它不获取执行权，不运行Harness恢复或schema migration，禁止commit/mintId；失败和结束都关闭。schema版本、全部原生表/列与next_id/next_seq校验；缺失、旧版本、坏库拒绝且数据库/WAL已提交字节保持不变。next_seq损坏先被错误接受的reproducer已修正，新增断言通过。
- 已安装原生SqliteStorage只有会迁移的open，没有公开readonly constructor。依据锁定源码constructor只赋(db,nextId)的事实，经上述校验后Reflect.construct实例化；保留原生document/history引擎，不复制读实现。依赖升级必须重新验证这一接缝，README同步说明此限制。
- 真实子进程在child unsafe write已发生而receipt未提交时SIGKILL；只读list/snapshot不改DB/WAL，resume等待关联Request和Reporter结算，child保留身份、unknown outcome，效果mtime不变，无unsafe重放。所有独立child仍只发现一根Session。

### Verification

- `bun install --frozen-lockfile`通过，853packages，961ms。
- focused impacted set：store、desktop SQLite/data、Session ownership/list、queue/replay/subagent reconciliation/unknown outcomes及server，72pass、0fail、13files、6.87s。全部新增/修改测试单例低于1s；SQLite subprocess contender670ms、unsafe child crash264ms、Session持久化42ms、busy pinned frame7ms，保留真实进程/信号合同成本。
- sqlite adapter focused：2pass、0fail、11assertions，117ms；验证WAL/FULL、事务排队/rollback/handle失效/ordered close、readonly pinned frame与拒绝写入/缺失不建库。
- `bun run check:dev`通过format/lint/types/Knip/tracker/docs/ink/test-policy/typography；后续metadata校验修正再次focused通过，最终同一check:dev再次通过。
- 初次server focused中busy观察测试仍写死main.jsonl而失败，更新为session.sqlite后通过。完整focused集有一条SQLite disk-I/O warning：server未跟踪changed()的异步summary读取，close完成后fixture移除根导致迟到读取；已定位并交03在server生命周期整合中修复，不能以测试通过隐藏该warning。
- 本票未运行aggregate check、CI、真实safeStorage或打包验收；归06最终集成。没有push、PR或外部merge。

### ADR Coverage

实现ADR-0035的原生SQLite、WAL/FULL、跨进程执行lease和只读合同；保留ADR-0024 Harness恢复/replay与父子ownership，终端JSONL行为沿原生接口不变。应用索引原子持久化归03，完整工具输出分块归04，最终退出/打包验收归06；无需新增ADR。

Final closure: integrated implementation, independent review and applicable local verification complete. Unified browser and genuine packaged acceptance are recorded in [06](06-integration-and-packaged-acceptance.md); spec/tickets close together after that gate. Prior aggregate environment failures remain recorded separately from passing focused follow-up. Final documentation commit CI remains pending until observed on the PR.
