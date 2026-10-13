# 04：永久删除 Session

Status: ready-for-agent

Blocked by: 01

**What to build:** 按 [spec](../spec.md#永久删除) 让用户从会话菜单经确认后永久删除 Session，移除其全部存储与外部文件。

- [ ] Agent Core store 能力新增删除接口：先取得写入租约确认无其他宿主占用，再删除根 Session 存储目录（含共用存储的子代理）及数据根下该 Session 的 `attachments/` 与 `file-history/`；路径解析保持在数据根内；租约被占用时返回 session-busy 且不删除任何文件
- [ ] 新增 wire 命令 `session.delete { sessionId }`：拒绝执行中或有挂起交互的 Session；已在本服务打开且空闲时先关闭并释放租约；删除后从 `pinned` 与 `archived` 移除该 id，发出 `sessions_changed`，删除当前 Session 时携带 `closedSessionId`
- [ ] 确认对话框遵循 DESIGN.md 对话框规则，写明不可撤销，确认按钮为危险样式；取消不发送命令
- [ ] 会话行右键、行内更多与标题栏“会话更多”加入“永久删除”，危险色；执行中或等待确认时禁用；删除当前 Session 后回到首页新聊天
- [ ] zh 与 en 文案同步
- [ ] 测试：store 层覆盖删除后列表不再出现、子代理与外部文件被移除、租约占用时不删除、不越出数据根；server 测试覆盖删除、置顶与归档清理、执行中拒绝、已打开空闲 Session 的关闭与 `closedSessionId`；shell browser 覆盖确认与取消、禁用状态、删除当前 Session 后回到新聊天
