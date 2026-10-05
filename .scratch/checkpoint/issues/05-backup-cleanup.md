# 05: 过期备份清理

**What to build:** `createSession` 启动时，删除 `~/.neant/file-history/` 下 mtime 超过 30 天的 session 备份目录，防止磁盘无限增长。清理失败只发 warning，不影响启动。见 [spec](../spec.md)"清理"。

**Blocked by:** 02

**Status:** claimed

- [ ] 超过 30 天的目录被删，30 天内的保留，当前 session 目录不受影响
- [ ] 目录不存在或删除失败时只经 `onWarning` 告警
- [ ] 清理不阻塞会话创建的正确性（可异步，但测试可等待其完成）
- [ ] e2e 测试：预置旧 mtime 目录验证

## Comments

### Implementation ready for review — 2026-10-05

- `createSession` 的公开包装层等待启动清理完成，使用真实 session id 保护当前目录（含恢复超过 30 天的 session）；内部子 session 创建不重复清理。
- `checkpoint/cleanup.ts` 按 session 目录 mtime 删除严格超过 30 天的备份。保留边界、近期目录及非目录条目；缺失目录、读取或删除失败通过现有 `onWarning` 路径告警，继续启动和其他目录的清理。
- 公开 `createSession` e2e 共 5 个用例覆盖过期 / 边界 / 近期、恢复旧 session 后仍可 rewind、缺失目录、真实权限导致的删除失败，以及普通文件 / 符号链接保留。
- 已有测试的正常启动临时 home 预建空 `file-history`，维持原有精确 stderr / warning 断言；缺失和非法目录用例显式禁用该 fixture，保留故障测试。
- TDD：首个清理用例先以过期目录仍存在失败，再实现通过。相关 Agent Core 141 pass / 0 fail；CLI/TUI 117 pass / 0 fail；`bunx tsc -b` exit 0。
- 最终隔离临时 HOME 执行 `env -u NO_COLOR caffeinate -is bun run check` exit 0：1488 pass / 0 fail，7664 expect，112 files；日志 `/tmp/neant-checkpoint-05-final-check.log`。
- 固定审查点 `75f8559509ef5955af64271b4dbffe3292f01aae`；Standards / Spec 两轴独立审查待父代理统一安排，尚未 resolved。
