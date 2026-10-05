# 文件外部修改检测审查

## Standards

审查结果：0 条发现。

## Spec

### P2：提醒保存失败会丢失外部变化通知

审查发现：`currentContent` 在 reminder 写入 Transcript 前就保存新 hash 或移除删除记录。若 reminder 追加失败，同进程重试或 Session Resume 无法再次检测该变化。旧的 `acknowledgeReminder` 仅保护 diff 的写入权限，没有保护通知送达；这违反 spec 的删除通知及未报告变化不得更新基线或移出跟踪集的要求。

修复：对所有选入预算的 diff、仅路径和删除报告保存旧基线与保守的过期标记，提醒持久化后再提交对应候选基线或移除记录。候选保留在当前进程，Tool State version 1 与不保存内容的约束保持原样。成功文件工具仍在 PostToolUse 前保存新基线。Run 清理也重置请求预算，避免 prompt 阶段提醒保存失败留下耗尽的预算。

红灯：新增删除提醒保存失败后 resume 回归，预期 1 条 `Deleted: file.txt` reminder，实际 0 条。新增接近 16K 的 prompt 提醒失败后重试回归，预期 1 条 reminder，实际 0 条。两项均通过 `createSession`、fake model、隔离目录和注入的 SessionStore 公共接缝复现。

绿灯：`rtk proxy bun test packages/agent/tests/e2e/file-changes.test.ts`，46 pass / 0 fail，405 assertions。覆盖删除、diff、仅路径保存失败后的同进程重试与 resume、成功保存后的静默、仅路径及 resume 的 stale guard、16K 预算释放和预算批次行为。

相关回归：`rtk proxy bun test packages/agent/tests/e2e/file-changes.test.ts packages/agent/tests/e2e/todo-reminders.test.ts packages/agent/tests/e2e/session-recovery.test.ts packages/agent/tests/e2e/checkpoint.test.ts packages/agent/tests/e2e/checkpoint-subagents.test.ts packages/agent/tests/e2e/compaction.test.ts`，119 pass / 0 fail，847 assertions。

Rewind 回归随契约更新：回退到失败报告前的已知基线时，hash 匹配的旧内存内容仍可保留；重试 reminder 成功保存后 diff 已成为模型知识，edit 可成功并保留外部改动行。原测试要求无 diff 且 edit 拒绝，依赖的是提前推进基线导致丢弃内存内容的实现。新的测试验证 diff 到达 edit 的模型请求，以及最终磁盘保留外部内容。hash 不匹配时仍丢弃内容。

最终 aggregate check 在 integration branch 执行。

静态检查：`rtk proxy bunx --no -- tsc -b`、`rtk proxy bunx --no -- oxlint`、`rtk proxy bunx --no -- knip`、`rtk proxy bunx --no -- oxfmt --check` 与 `rtk git diff --check` 均通过。
