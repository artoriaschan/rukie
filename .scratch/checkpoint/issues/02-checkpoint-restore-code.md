# 02: 单 prompt Checkpoint 与只回代码

**What to build:** 每条 user prompt 自动建 Checkpoint：同一 Checkpoint 内，`write` / `edit` 首次写某文件前把原内容备份到 `~/.neant/file-history/<sessionId>/`（按内容 hash；原本不存在的文件也要记下来），引用作为 Tool State `checkpoint` 记入 transcript。Session 提供 `checkpoints()` 与 `rewind(promptEntryId, { code: true, conversation: false })`，可以把文件还原到那条 prompt 之前。见 [spec](../spec.md) Implementation Decisions 的"快照时机 / Checkpoint 锚点 / 备份存储 / Tool State / Session API / 回代码"。

Blocked by: 01

Status: resolved

- [x] 快照挂在放行后阶段；路径经与权限相同的 realpath 规范化；bash / MCP 工具不快照
- [x] 同 prompt 内多次写同一文件只备份首次
- [x] `checkpoints()` 按时间返回 promptEntryId、预览与改动文件
- [x] 只回代码：从目标起所有 Checkpoint，每个路径取最早记录，写回备份或删除新建文件；之后的手动改动被覆盖
- [x] 先校验备份齐全，缺失则整体报错、不改动任何文件
- [x] 返回已还原 / 已删除的文件；只回代码不改 transcript
- [x] session running（或有 running 子代理）时 `rewind` 抛错
- [x] resume 后 `checkpoints()` 与 rewind 仍可用；被拒写入不留快照
- [x] `CONTEXT.md` 的 Checkpoint 定义与实现一致
- [x] e2e 测试（`tests/e2e/checkpoint.test.ts`）覆盖以上

## Answer

已完成单 prompt Checkpoint 与只回代码。公开 API 为 `checkpoints(): Checkpoint[]`（`promptEntryId`、`preview`、`files: { path, backup: string | null }[]`）与 `rewind(promptEntryId, { code: true, conversation: false })`，返回 `{ prompt, restored, deleted }`。备份按 sha256 保存原样字节，使用 Session 注入的 `homeDir/.neant/file-history/<sessionId>/`；测试通过 `tempDirs` 与隔离临时 HOME，不写用户备份目录。

真实 user prompt 在 `message_end` 持久化后以 entry id 开锚点；hook 内部 run、Stop feedback、steer 通知和子 session 不另开锚点。`write` / `edit` 放行后记录最终参数的 canonical realpath，内部观察器的可变副本不影响快照目标。hook 参数改写会重走工具 `prepareArguments` 并严格校验，修复 `~/`、`@`、file URL 重写后的执行目标与快照不一致。恢复先读取全部备份，再按目标起每条路径的最早记录恢复或删除；只回代码不修改 transcript 与 Tool State。compaction 准备时忽略无模型内容的 custom entries，原 transcript 保留完整。

- 验证：checkpoint focused 13 pass / 0 fail；checkpoint、post-allow-stage、permission-hooks、permission-paths、permission-rules 共 113 pass / 0 fail；`bunx tsc -b` exit 0。
- 最终全套：隔离临时 HOME、`env -u NO_COLOR`、`caffeinate -is bun run check` exit 0，1483 pass / 0 fail，7647 expect，111 files，167.55s；format、lint、typecheck、knip 均通过。
- code-review 固定点 `dbb0da1b57adacf80b142953841937da4a87a389`：独立 Standards 最终 0 findings；独立 Spec 初次追加发现路径不一致 P1，修复后复核 0 findings，审查者独立运行 67 pass / 0 fail。
- 实现提交：`e862e52`（Checkpoint 与 code rewind）、`0cc6a78`（hook 改写路径一致性及公开回归）。

后续接口：03 可复用 `checkpoint.prompt()` / `restoreCode()`、`promptTexts` 与完整 branch entries，重建 `toolState` 后记录器通过 `getState` 读取新状态；Session 已有同步 `rewinding` 锁。04 使用 `InternalSessionOptions.checkpoint` 按引用传入父记录器；子 session 当前不会自行建锚点，但父归属由 04 接入。05 的启动清理保持独立。conversation、子代理归属完善、清理、TUI 均仍由对应后续工单交付。
