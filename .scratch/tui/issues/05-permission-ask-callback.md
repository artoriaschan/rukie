# 05: Agent Core 把 `ask` 交给 frontend

**What to build:** 需要授权的工具被调用时，Agent Core 通过 `SessionOptions.onPermissionAsk` 询问 frontend，按回答放行或拒绝。没传回调时按 deny 处理，所以 `neant-cli` 的行为完全不变。CONTEXT.md 里 Permission Decision 已经按这个语义更新过了。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 不在只读集合、不匹配 `allowTools`、没开 yolo 的工具，`decidePermission` 返回 `ask`
- [x] `onPermissionAsk({ toolCallId, toolName, args, signal })` 返回 `allow` 时工具执行，返回 `deny` 时阻止调用、给模型返回“该工具未获授权”、发出 `permission_denied`
- [x] 没传回调时，`ask` 按 deny 处理；`neant-cli` 现有的 e2e 测试不改也能通过
- [x] 已经放开的工具不会触发回调
- [x] run 被 abort 时，正在等待的回调按 deny 处理，`signal` 处于 aborted 状态
- [x] 回调的请求类型从包入口导出
- [x] 测试走 Agent Core 公开接口（假 `streamFn` 加临时目录）
- [x] `bun run check` 全绿

## Comments

- 2026-10-02：Agent Core 通过 `SessionOptions.onPermissionAsk` 交给 frontend 决定单次工具调用，公开导出 `PermissionAskRequest`；未传回调时继续拒绝，已允许的工具直接执行。
- 新增 10 项公开接口测试，覆盖放行、拒绝、只读集合和显式授权跳过回调、一次放行不影响后续调用，以及 abort 时 frontend 不响应、返回 allow 或拒绝 Promise 的情况。取消等待不会依赖 frontend 的 Promise 完成，取消信号同步通知 frontend，并发出 `permission_denied`。
- `bun run check` 全通过：格式、lint、`tsc -b`、Knip，以及全仓库 150 tests / 779 assertions；现有 Headless CLI e2e 未修改。code-review 的 Standards 和 Spec 两轴均无发现。
