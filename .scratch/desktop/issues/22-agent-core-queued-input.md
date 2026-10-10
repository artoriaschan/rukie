# 22: Agent Core 公开 Queued Input

**What to build:** 把 Run 进行中的排队输入公开为 Session API：发送返回 `requestId`，可按 `requestId` 撤回或立即放入，abort 时交还全部原文与附件。见 [spec](../spec.md) 的「Agent Core 前置改动」与 CONTEXT.md 的 Queued Input。

Blocked by: None (can start immediately)

Status: resolved

- [x] `followUp(prompt, {images?})` 在 Run 进行中返回 `requestId`，输入在当前 Run 停止调用工具后放入，多条按发送顺序各自形成一次用户消息
- [x] 按 `requestId` 撤回返回原文与附件；目标已放入对话时返回可区分的结果（供 server 映射为 `not_queued`）
- [x] 按 `requestId` 改为立即放入（steer）
- [x] `abort()` 撤回全部 Queued Input，结果按排队顺序带回原文与附件
- [x] 崩溃后恢复：已持久化的 Queued Input 在 snapshot 中可见，并按原顺序放入
- [x] 接缝：`createSession` + `fakeModel`；崩溃恢复沿用现有 crash worker helper

## Comments

Issue 22 专用子代理实施；保持 claimed，等待集成分支评审与最终验收。

- TDD 接缝：createSession + 现有 fake model 边界（recordedNativeModel）；恢复复用 native-recovery helper 与 subagent-recovery-worker，以 SIGKILL 杀死公开 followUp 确认后的进程。
- 红：followUp 未公开时公开输入测试失败；恢复测试在 helper/API 缺失时失败；原生 view 仅含 built-in docs 导致恢复 snapshot 的队列为空，补入既有 pending-input-facts 后转绿。
- 实现：followUp 返回稳定 requestId；并发 admission 串行保留发送顺序；withdraw/steerNow 按身份操作唯一原生 inbox；withdraw 和 abort 的原文/附件交还与移出队列在同一事务；abort 返回排队顺序数组。公开 queuedInputs、snapshot.queuedInputs 与 queued_inputs_update，保留名称并恢复。
- 本地验证：`bun test packages/agent/tests/e2e/queued-input.test.ts packages/agent/tests/e2e/images.test.ts packages/agent/tests/session packages/coding-agent/tests/view/conversation/activity/activity.test.ts`：69 pass / 0 fail / 5 files，1.024s 总计；新增队列文件 4 pass，470ms，总体每例少于 1s。实际子进程恢复覆盖已确认队列、原顺序、图片及名称。
- `bun run check:dev` 通过（format、lint、types、Knip、scratch、docs、ink boundaries、test policy）。不运行全套；集成负责人负责最终聚合验收。
- 文档：沿用 rukie-doc skill 更新 Agent README 的 Queued Input API 和取消/恢复义务。ADR 归属沿用 spec 中 ADR-0024 原生 inbox/恢复以及 ADR-0032 共享 JSONL，没有第二套队列或新持久化后端。

## Answer

Queued Input 原文、图片与 requestId 公开；followUp、立即发送、撤回及 abort 有序回填使用原生 inbox 和完成记录，恢复与同 Run steering 回归通过。

最终代码集成 `8af81b85`；独立双轴评审、后续修复、适用本地验证和 ADR Coverage 结论见 [spec 的交付证据](../spec.md#delivery-evidence)。本地工作已完成，最终推送的 CI 尚待验收；此状态不表示 PR 已合并。
