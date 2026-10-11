# 02: 原生 SQLite Session 存储与只读接口

**What to build:** 按[存储调整规格](../spec.md)和 [ADR-0035](../../../docs/adr/0035-desktop-isolated-sqlite-storage.md) 实施本票能力。

Blocked by: 01

Status: ready-for-agent

- [ ] 检查锁定 pi-durable SqliteDatabase/Storage 接口，以 bun:sqlite 实现事务排队、回滚/关闭与 WAL/FULL；逐独立根 Session/Harness 原生 storage，子代理仍属于根 Harness
- [ ] 更新 SessionStore 的 create/resume/list/key 与 JSONL 硬编码只读 storage/snapshot 调用，覆盖 subagent、恢复与清理全部消费者
- [ ] 保留跨进程单执行者 lease，busy snapshot 读取一致已提交帧且不 repair/recover 或执行 schema migration；索引只发现本根 Session
- [ ] 真实 Session/fake model 与真实子进程验证 crash、resume、只读、lease、空闲关闭；TUI 默认 JSONL 回归与 focused 性能证据
