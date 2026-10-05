# 04: 跟踪集持久化与 resume

**What to build:** 关闭 session 期间被改的文件，resume 后的第一次模型请求前被报告为"已修改，请重新 read"（无 diff），随后的 edit 被过期检查拒绝，直到重读。详见 [文件外部修改检测 spec](../spec.md) 的持久化与 resume 两节。

**Blocked by:** 03

**Status:** resolved

- [x] Tool State `file-tracking` version 1，值 `{ files: Array<{ path, mtimeMs, size, hash, stale }> }`，TypeBox 校验；不存内容，不提供 `renderReminder`
- [x] 基线每次变化（工具执行后、报告后、删除移出）写完整快照，last-wins；坏记录按地基 B 跳过并告警
- [x] resume 从 Tool State 恢复跟踪集；无内存内容的变化走只列路径 + `stale` 分支
- [x] e2e：关闭 session → 改文件 → 重建 session → 首次请求报"已修改"且无 diff；edit 被拒，read 后成功；未改动的文件不报

## Implementation and verification

- `file-tracking` 注册 version 1 完整快照，仅持久化规定的五个文件字段。TypeBox 和同一校验路径检查绝对路径、非负整数 size、SHA-256 hash、有限 mtime 与无额外字段；地基 B 提供 last-wins、坏记录告警和跳过。
- 工具基线、touch 元数据、最终预算确认后的修改报告与删除写入完整快照。恢复时丢弃磁盘内容；提醒序号承接已保存事件，防止重复路径提醒被跨进程去重。提供 `restore` 供后续对话 Rewind 接线，保留内容仅限 hash 相符。
- 检测快照写入失败回滚内存基线并传播错误；文件工具的快照失败作为工具错误返回，不放开未经确认的写入。所有报告先保存旧基线与保守的 stale 标记，仅在提醒写入 Transcript 后提交新基线或移除删除记录，关闭保存顺序中的覆盖漏洞并保持失败后的通知可重试。
- 红灯：新 resume write/edit 回归均复现外部内容被覆盖；快照失败重试回归复现变化被丢弃；提醒保存失败后 resume 回归复现 edit 错误放行。绿灯：`rtk proxy bun test packages/agent/tests/e2e/file-changes.test.ts packages/agent/tests/e2e/todo-reminders.test.ts packages/agent/tests/e2e/session-recovery.test.ts`，48 pass / 0 fail，423 assertions。
- `rtk proxy bunx --no -- tsc -b`、`rtk proxy bunx --no -- oxfmt --check`、`rtk proxy bunx --no -- oxlint`、`rtk proxy bunx --no -- knip` 与 `rtk git diff --check` 均通过。全部仓库 aggregate check 由 integration branch 交付时执行。

## Review resolution

- Spec P2 修复与红绿证据见 [review.md](../review.md)。覆盖删除、diff、只列路径提醒保存失败后同进程重试和 resume，成功报告后不重复；接近 16K 的 prompt 提醒失败也释放下一 Run 的请求预算。Tool State version 1 的字段保持原样。
- 相关文件跟踪、Todo reminder、Session 恢复、Checkpoint、子代理 Checkpoint 和 Compaction e2e：119 pass / 0 fail，847 assertions。integration branch 负责最终 aggregate check。
