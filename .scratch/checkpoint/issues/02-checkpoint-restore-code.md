# 02: 单 prompt Checkpoint 与只回代码

**What to build:** 每条 user prompt 自动建 Checkpoint：同一 Checkpoint 内，`write` / `edit` 首次写某文件前把原内容备份到 `~/.neant/file-history/<sessionId>/`（按内容 hash；原本不存在的文件也要记下来），引用作为 Tool State `checkpoint` 记入 transcript。Session 提供 `checkpoints()` 与 `rewind(promptEntryId, { code: true, conversation: false })`，可以把文件还原到那条 prompt 之前。见 [spec](../spec.md) Implementation Decisions 的"快照时机 / Checkpoint 锚点 / 备份存储 / Tool State / Session API / 回代码"。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 快照挂在放行后阶段；路径经与权限相同的 realpath 规范化；bash / MCP 工具不快照
- [ ] 同 prompt 内多次写同一文件只备份首次
- [ ] `checkpoints()` 按时间返回 promptEntryId、预览与改动文件
- [ ] 只回代码：从目标起所有 Checkpoint，每个路径取最早记录，写回备份或删除新建文件；之后的手动改动被覆盖
- [ ] 先校验备份齐全，缺失则整体报错、不改动任何文件
- [ ] 返回已还原 / 已删除的文件；只回代码不改 transcript
- [ ] session running（或有 running 子代理）时 `rewind` 抛错
- [ ] resume 后 `checkpoints()` 与 rewind 仍可用；被拒写入不留快照
- [ ] `CONTEXT.md` 的 Checkpoint 定义与实现一致
- [ ] e2e 测试（`tests/e2e/checkpoint.test.ts`）覆盖以上
