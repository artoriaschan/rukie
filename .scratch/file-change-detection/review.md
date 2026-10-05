# 文件外部修改检测审查

## Standards

初审与续审结果：0 条发现。

## Spec

### P2：提醒保存失败会丢失外部变化通知

审查发现：`currentContent` 在 reminder 写入 Transcript 前就保存新 hash 或移除删除记录。若 reminder 追加失败，同进程重试或 Session Resume 无法再次检测该变化。旧的 `acknowledgeReminder` 仅保护 diff 的写入权限，没有保护通知送达；这违反 spec 的删除通知及未报告变化不得更新基线或移出跟踪集的要求。

修复：对所有选入预算的 diff、仅路径和删除报告保存旧基线与保守的过期标记，最终候选基线或删除记录与提醒在同一原生事务提交。候选保留在当前进程，Tool State version 1 与不保存内容的约束保持原样。成功文件工具仍在 PostToolUse 前保存新基线。Run 清理也重置请求预算，避免 prompt 阶段提醒保存失败留下耗尽的预算。

红灯：新增删除提醒保存失败后 resume 回归，预期 1 条 `Deleted: file.txt` reminder，实际 0 条。新增接近 16K 的 prompt 提醒失败后重试回归，预期 1 条 reminder，实际 0 条。两项均通过 `createSession`、fake model、隔离目录和注入的 SessionStore 公共接缝复现。

首次修复绿灯：`rtk proxy bun test packages/agent/tests/e2e/file-changes.test.ts`，46 pass / 0 fail，405 assertions。覆盖删除、diff、仅路径保存失败后的同进程重试与 resume、成功保存后的静默、仅路径及 resume 的 stale guard、16K 预算释放和预算批次行为。

相关回归：`rtk proxy bun test packages/agent/tests/e2e/file-changes.test.ts packages/agent/tests/e2e/todo-reminders.test.ts packages/agent/tests/e2e/session-recovery.test.ts packages/agent/tests/e2e/checkpoint.test.ts packages/agent/tests/e2e/checkpoint-subagents.test.ts packages/agent/tests/e2e/compaction.test.ts`，131 pass / 0 fail，997 assertions。

Rewind 回归随契约更新：回退到失败报告前的已知基线时，hash 匹配的旧内存内容仍可保留；重试 reminder 成功保存后 diff 已成为模型知识，edit 可成功并保留外部改动行。原测试要求无 diff 且 edit 拒绝，依赖的是提前推进基线导致丢弃内存内容的实现。新的测试验证 diff 到达 edit 的模型请求，以及最终磁盘保留外部内容。hash 不匹配时仍丢弃内容。

### P2：仅 BOM 的 UTF-8 变化产生空 diff

红灯：添加或移除 BOM 的两条公共回归，预期 diff 中出现实际的 `-text` / `+\ufefftext` 或逆向改动行，实际只有 patch 标题，0 pass / 2 fail。

修复：UTF-8 解码使用 `ignoreBOM: true`，将 BOM 作为文本内容保留，hash 比较与 diff 表示同一份字节知识。相同命令只运行 BOM 回归后，2 pass / 0 fail。

### P2：提醒已落盘但最终确认快照失败，导致重复通知

红灯：跳过保守快照，拒绝最终确认快照后 resume；模型上下文出现 2 条同一变化的 reminder，预期 1 条。

修复：确认锁定 pi 的 `Session.mutate`、`appendToBranch` 与 JSONL v4 事务实现后，在现有 Tool State `set` 上增加可选伴随 reminder。最终快照、message entry 与 `main` tip 在同一个原生 commit 中提交，消除分开的提醒追加与基线确认窗口。prompt message_end、请求准备及 Compaction 均使用这一入口，失败回滚当前进程候选，不增加持久化格式、内容字段或 frontend 事件。失败测试在 native mutator 的 commit 边界拒绝整组写入。

同进程重试补充红灯：pi 在持久化监听器前已将 `message_end` 输入放进内存，最终事务失败后的 diff、仅路径及删除重试仍会向模型发出 2 条提醒。修复仅在文件提醒事务失败时移除该未落盘输入；6 条同进程 / resume 回归均验证模型上下文只有 1 条报告，成功报告后不重复。请求准备与 Compaction 失败回归也验证恢复上下文只有 1 条报告。

预算补充红灯：近 16K 的手动 Compaction 提醒保存失败后，下一 Run 没有报告（预期 1 条）；实际自动 Compaction 请求消耗第一批报告后，延期文件没有在随后的模型请求前报告（预期 2 批，实际 1 批）。失败事务释放自身预留预算；实际摘要请求完成后重置预算，未发生 Compaction 时不重置。回归验证 90 个文件各报告一次，每批不超过 16K，延期批次已进入下一模型请求。

最终 aggregate check 已在 integration branch 通过，完整结果见 [验收记录](verification.md)。

续审修复绿灯：`rtk proxy bun test packages/agent/tests/e2e/file-changes.test.ts`，58 pass / 0 fail，555 assertions；相关生命周期 e2e 131 pass / 0 fail，997 assertions。

静态检查：`rtk proxy bunx --no -- tsc -b`、`rtk proxy bunx --no -- oxlint`、`rtk proxy bunx --no -- knip`、`rtk proxy bunx --no -- oxfmt --check` 与 `rtk git diff --check` 均通过。

### 测试稳定性：并发读取顺序

续审发现接近 16K 的失败预算回归假定首个文件必定进入第一批，但并发 read 的完成顺序决定跟踪顺序。测试改为检查第一批为非空子集、两批覆盖全部 90 个文件且各报告一次，后续请求静默。重点回归 17 pass / 0 fail，完整文件检测 58 pass / 0 fail，741 assertions；产品代码未改。最终 Standards 与 Spec 审查均为 0 条剩余发现。
