# 05: compaction、rewind、子代理场景

**What to build:** 跟踪在 compaction 后照常工作；rewind 只回退代码时恢复的文件被报告，回退对话时跟踪集随之回退；子代理写入父已读的文件时，父下一次请求前被告知。详见 [文件外部修改检测 spec](../spec.md) 的 compaction、rewind、子代理三节。

Blocked by: 04

Status: resolved

- [x] compaction 后跟踪集与内存内容保留；`file-changes` 不在 compaction 后重注入
- [x] rewind 回退对话：Tool State 投影回退后，hash 与快照不符的内存内容丢弃
- [x] e2e：compaction 后外部改 → 仍报 diff
- [x] e2e：rewind 只回退代码 → 恢复的文件下一次请求前被报告；回退代码+对话 → 跟踪集与回退点一致，无误报
- [x] e2e：子代理 write 父已读文件 → 父下一次请求报告

## Comments

- 2026-10-06：从 integration `28a2c0b` 领取并完成。公开 `createSession` e2e 先复现代码+对话 Rewind 后错误报告已恢复文件及已放弃的读取路径，再将 `fileTracking.restore` 接到 Tool State 对话恢复边界；恢复时清空尚未确认的 diff 与当前请求预算，只有 hash 匹配的内存内容继续保留。
- 覆盖 Compaction 后保留 diff 知识且不重注入旧事件；代码、对话、组合 Rewind；失败报告后回退保留旧基线，成功交付 diff 后 edit 保留外部内容；普通 Subagent 与 fork 独立读取、子写入父已读文件；真实 PostToolUse formatter 改写后下一请求提示 diff 并可使用格式化内容 edit。架构文档同步描述生命周期行为。
- 验证：`bun test packages/agent/tests/e2e/file-changes.test.ts packages/agent/tests/e2e/compaction.test.ts packages/agent/tests/e2e/checkpoint.test.ts packages/agent/tests/e2e/checkpoint-subagents.test.ts packages/agent/tests/e2e/subagents.test.ts`：112 pass / 0 fail / 817 assertions。`bunx --no -- oxfmt --check`、`oxlint`、`tsc -b`、`knip`、`git diff --check` 均通过（实际命令按仓库要求使用 RTK 前缀）。集成分支最终完整 aggregate 由主代理执行。
- 2026-10-06：最终集成完整检查已通过，审查与工作区归档完成，见 [验收记录](../verification.md)。
