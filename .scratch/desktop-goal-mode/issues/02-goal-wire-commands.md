# 02：Goal wire 命令

Status: ready-for-agent
Blocked by: 01

**What to build:** 按 [spec](../spec.md) 的「wire 与 server」一节，开放桌面端和 Web 端创建、暂停、继续与清除 Goal 的能力。

- [ ] `session.create` 新增可选字段 `goal: true`：调用 `createGoal(text, { images })`；只在 `goal: true` 时允许空文本，此时 `images` 至少一项
- [ ] 新增 `session.goal_create`、`session.goal_pause`、`session.goal_resume`、`session.goal_clear`，在 server 中完成校验与分发
- [ ] Goal 的 UserVisibleError 错误码沿用现有的回传方式，并补入客户端错误码白名单
- [ ] 不新增事件；确认 snapshot 与 `tool_state_changed` 中的 `toolStates.goal` 带上 version 2 的字段
- [ ] 更新 `packages/server/README.md` 和 `packages/shared` 的 wire 类型
- [ ] 测试：新聊天 goal 创建、四个命令、空文本加图片校验、错误码、状态推送；`bun test packages/server packages/shared`

## Comments
