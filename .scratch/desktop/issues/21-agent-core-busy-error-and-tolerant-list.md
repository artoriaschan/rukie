# 21: Agent Core busy 错误码与容错列举

**What to build:** 为桌面端准备两项 Agent Core 前置改动：lease 被占用时抛出带 code 的 user-visible error，`listSessions` 按目录容错。见 [spec](../spec.md) 的「Agent Core 前置改动」。

Blocked by: None (can start immediately)

Status: ready-for-agent

- [ ] 另一个进程持有 lease 时打开 Session，得到带 code 的 user-visible error（含 zh/en 文案），不再是普通 `Error("Session already open")`
- [ ] 同进程重复打开同一 Session 的报错同样带 code
- [ ] 单个 Session 的索引读取失败时，`listSessions` 跳过它并经 `onWarning` 上报，其余 Session 照常列出
- [ ] TUI 与 Headless CLI 对 busy 错误的显示与改动前一致或更清晰，相关测试同步更新
- [ ] 接缝：`createSession` + `fakeModel`；跨进程 lease 用现有 `session-store-worker` 子进程 helper
