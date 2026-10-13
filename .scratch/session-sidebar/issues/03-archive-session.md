# 03：归档 Session

Status: ready-for-agent

Blocked by: 01

**What to build:** 按 [spec](../spec.md#归档) 让用户从会话菜单归档 Session：Archived Session 从侧栏与搜索中隐藏，Transcript 与 Session Store 不变。

- [ ] 桌面端应用数据库 registry 新增 `archived` Session id 列表，与 `pinned` 并列；`sessions_changed` 增加 `archived` 字段，store 校验并保存
- [ ] 新增 wire 命令 `session.archive { sessionId }`：校验 Session 存在、未执行且无挂起交互；从 `pinned` 移除并加入 `archived`；保存后发出 `sessions_changed`，归档当前 Session 时携带 `closedSessionId`
- [ ] `session.pin` 拒绝 Archived Session
- [ ] 侧栏分组与现有搜索结果排除 Archived Session
- [ ] 会话行右键、行内更多与标题栏“会话更多”加入“归档”；执行中或等待确认时禁用；归档当前 Session 后回到首页新聊天
- [ ] zh 与 en 文案同步
- [ ] 测试：server 测试覆盖归档、置顶移除、执行中拒绝、`closedSessionId` 与 `session.pin` 拒绝；store 测试覆盖 `archived` 解析与非法值；shell browser 覆盖侧栏与搜索隐藏、禁用状态、归档当前 Session 后回到新聊天
