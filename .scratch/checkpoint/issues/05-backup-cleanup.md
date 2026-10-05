# 05: 过期备份清理

**What to build:** `createSession` 启动时，删除 `~/.neant/file-history/` 下 mtime 超过 30 天的 session 备份目录，防止磁盘无限增长。清理失败只发 warning，不影响启动。见 [spec](../spec.md)"清理"。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] 超过 30 天的目录被删，30 天内的保留，当前 session 目录不受影响
- [ ] 目录不存在或删除失败时只经 `onWarning` 告警
- [ ] 清理不阻塞会话创建的正确性（可异步，但测试可等待其完成）
- [ ] e2e 测试：预置旧 mtime 目录验证
