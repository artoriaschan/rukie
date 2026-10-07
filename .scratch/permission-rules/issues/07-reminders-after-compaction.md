# 07: compaction 后 reminder 重发

**What to build:** compaction 后，模型立即重新看到 date、user / project instructions、skills、MCP 说明、frontend 传入的 reminder source，以及 Tool State（environment 是一次性快照，不重发）。下一个 run 不重复发送内容未变的 reminder。resume 后恢复的 context 与 compaction 当时一致。reminder 去重统一只对照最近一次 compaction 之后的 transcript，去掉 Tool State source 的特例。

Blocked by: None (can start immediately)

Status: resolved

参考：[spec](../spec.md)「compaction 后 reminder 重发」；User Stories 38–40。

- [x] 先写一条会失败的 e2e，复现 compaction 后下一次模型请求里缺少 Project Instructions / skills reminder
- [x] e2e：compaction 后重发上述 source，environment 不重发
- [x] e2e：compaction 后的下一个 run 不重复发送未变化的 reminder；内容变化的照常发送
- [x] e2e：resume 后 `session.messages` 与 compaction 当时一致（reminder 块排在 retained tail 之前）
- [x] 现有 todo-reminders、compaction、reminders 测试保持通过
- [x] `tsc -b` 与全量 `bun test` 通过

## Comments

### 2026-10-04 implementation checkpoint

- Red: `bun test packages/agent/tests/e2e/compaction.test.ts -t 'Compaction restores current'` exit 1；压缩后下一条模型请求仅含 system、summary 与 retained request，缺少 `Preserve the widget contract.`。另一条 red 验证了压缩后下一 Run 误重发 environment 的边界。
- Compaction 立即收集 date、两层 Project Instructions、skills、MCP、frontend sources 与 Tool State 的当前内容，environment 保持一次性快照。所有 source 的去重统一使用最近 compaction 后的 Transcript；resume 恢复紧随 compaction 的完整 reminder 块，再放 retained tail。
- 公开 e2e 覆盖恢复提醒、下一 Run 去重与变更、真实 stdio MCP、连续 compaction、Todo List 与 resume context 一致性。更新旧的“instructions 只在首次 Run 读取”和“compaction 不重发 skills”预期，保持 Transcript 前缀只追加不改写。
- Context Usage 旧断言只计 summary；现在多计 date 与空 skills 列表的 reminder 文本，各 6 tokens。测试同时断言 faux model 收到两条确切 reminder，并保持 provider usage 重置的原断言。
- Validation: focused 四文件 35 pass / 0 fail；`rtk proxy env -u NO_COLOR bun run check` exit 0，765 pass / 0 fail，63 files（含格式、lint、`tsc -b`、knip）。
- Checkpoint 时 Standards / Spec 双轴 code review 待父代理安排，工单保持 in-progress。

### 2026-10-04 code review completed

- 父代理按 `code-review` skill 并行执行 Standards / Spec 双轴评审，固定点为 `ccbadad148ab76acaad14be91b39eaf034beee85`，实现提交为 `74251b3ef6fc86f7792ebeb5b349631da35500fd`。
- Standards: 0 findings。Transcript 只追加、原生 pi compaction / Session Store、测试运行时和 Locale 边界均符合仓库规范。
- Spec: 0 findings。全部 reminder source 重发、environment 一次性快照、统一去重、连续 compaction、内容变更、resume 顺序与一致性、真实 stdio MCP，以及 Context Usage 的公开 reminder 文本断言均满足 issue 07。
- 两轴均无待修复问题；实现保持不变。本次仅更新工单完成状态，沿用上述完整验收证据；父代理后续负责合并 main、集成验收与工作树清理。
