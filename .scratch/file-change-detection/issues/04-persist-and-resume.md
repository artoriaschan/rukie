# 04: 跟踪集持久化与 resume

**What to build:** 关闭 session 期间被改的文件，resume 后的第一次模型请求前被报告为"已修改，请重新 read"（无 diff），随后的 edit 被过期检查拒绝，直到重读。详见 [文件外部修改检测 spec](../spec.md) 的持久化与 resume 两节。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Tool State `file-tracking` version 1，值 `{ files: Array<{ path, mtimeMs, size, hash, stale }> }`，TypeBox 校验；不存内容，不提供 `renderReminder`
- [ ] 基线每次变化（工具执行后、报告后、删除移出）写完整快照，last-wins；坏记录按地基 B 跳过并告警
- [ ] resume 从 Tool State 恢复跟踪集；无内存内容的变化走只列路径 + `stale` 分支
- [ ] e2e：关闭 session → 改文件 → 重建 session → 首次请求报"已修改"且无 diff；edit 被拒，read 后成功；未改动的文件不报
