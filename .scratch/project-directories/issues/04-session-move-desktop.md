# 04：桌面端“移动到项目”

Status: ready-for-agent

Blocked by: 02, 03

**What to build:** 按 [spec](../spec.md#session-move) 新增 `session.move` 并在会话菜单三个入口提供“移动到项目”。

- [ ] `session.move { sessionId, projectId }`：目标为已登记 Project，cwd 改为其主目录；拒绝移回“对话”、目标主目录等于当前 cwd、执行中或有挂起交互；租约占用返回 `session_busy`
- [ ] 已打开且空闲的 Session 先关闭，再调用 02 的移动接口；未打开的 Session 不产生 Run 或 Resume；`sessions_changed` 推送新 cwd
- [ ] 会话操作单一定义新增“移动到项目”子菜单，列出除当前所属外的 Project；右键、行内更多、标题栏一致；执行中或等待确认时禁用
- [ ] 目标 Project 未信任时先显示信任确认框，确认后发送 `project.trust` 再移动；取消不移动
- [ ] 失败（会话被占用等）显示用户可见错误；zh 与 en 同步
- [ ] 测试：服务端 wire 覆盖准入、打开与未打开两种 Session、分组变化；UI browser 覆盖三个入口一致、禁用、未信任先确认、移动后分组变化
