# 05: Agent Core 把 `ask` 交给 frontend

**What to build:** 需要授权的工具被调用时，Agent Core 通过 `SessionOptions.onPermissionAsk` 询问 frontend，按回答放行或拒绝。没传回调时按 deny 处理，所以 `neant-cli` 的行为完全不变。CONTEXT.md 里 Permission Decision 已经按这个语义更新过了。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 不在只读集合、不匹配 `allowTools`、没开 yolo 的工具，`decidePermission` 返回 `ask`
- [ ] `onPermissionAsk({ toolCallId, toolName, args, signal })` 返回 `allow` 时工具执行，返回 `deny` 时阻止调用、给模型返回“该工具未获授权”、发出 `permission_denied`
- [ ] 没传回调时，`ask` 按 deny 处理；`neant-cli` 现有的 e2e 测试不改也能通过
- [ ] 已经放开的工具不会触发回调
- [ ] run 被 abort 时，正在等待的回调按 deny 处理，`signal` 处于 aborted 状态
- [ ] 回调的请求类型从包入口导出
- [ ] 测试走 Agent Core 公开接口（假 `streamFn` 加临时目录）
- [ ] `bun run check` 全绿
