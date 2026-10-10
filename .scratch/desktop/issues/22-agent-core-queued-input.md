# 22: Agent Core 公开 Queued Input

**What to build:** 把 Run 进行中的排队输入公开为 Session API：发送返回 `requestId`，可按 `requestId` 撤回或立即放入，abort 时交还全部原文与附件。见 [spec](../spec.md) 的「Agent Core 前置改动」与 CONTEXT.md 的 Queued Input。

Blocked by: None (can start immediately)

Status: ready-for-agent

- [ ] `followUp(prompt, {images?})` 在 Run 进行中返回 `requestId`，输入在当前 Run 停止调用工具后放入，多条按发送顺序各自形成一次用户消息
- [ ] 按 `requestId` 撤回返回原文与附件；目标已放入对话时返回可区分的结果（供 server 映射为 `not_queued`）
- [ ] 按 `requestId` 改为立即放入（steer）
- [ ] `abort()` 撤回全部 Queued Input，结果按排队顺序带回原文与附件
- [ ] 崩溃后恢复：已持久化的 Queued Input 在 snapshot 中可见，并按原顺序放入
- [ ] 接缝：`createSession` + `fakeModel`；崩溃恢复沿用现有 crash worker helper
