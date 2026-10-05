# 05: 过期备份清理

**What to build:** `createSession` 启动时，删除 `~/.neant/file-history/` 下 mtime 超过 30 天的 session 备份目录，防止磁盘无限增长。清理失败只发 warning，不影响启动。见 [spec](../spec.md)"清理"。

**Blocked by:** 02

**Status:** resolved

- [x] 超过 30 天的目录被删，30 天内的保留，当前 session 目录不受影响
- [x] 备份目录尚不存在时静默跳过、不创建目录；其他读取或删除失败只经 `onWarning` 告警
- [x] 清理不阻塞会话创建的正确性（可异步，但测试可等待其完成）
- [x] e2e 测试：预置旧 mtime 目录验证

## Comments

### Implementation ready for review — 2026-10-05

- `createSession` 的公开包装层等待启动清理完成，使用真实 session id 保护当前目录（含恢复超过 30 天的 session）；内部子 session 创建不重复清理。
- `checkpoint/cleanup.ts` 按 session 目录 mtime 删除严格超过 30 天的备份。保留边界、近期目录及非目录条目；缺失目录、读取或删除失败通过现有 `onWarning` 路径告警，继续启动和其他目录的清理。
- 公开 `createSession` e2e 共 5 个用例覆盖过期 / 边界 / 近期、恢复旧 session 后仍可 rewind、缺失目录、真实权限导致的删除失败，以及普通文件 / 符号链接保留。
- 已有测试的正常启动临时 home 预建空 `file-history`，维持原有精确 stderr / warning 断言；缺失和非法目录用例显式禁用该 fixture，保留故障测试。
- TDD：首个清理用例先以过期目录仍存在失败，再实现通过。相关 Agent Core 141 pass / 0 fail；CLI/TUI 117 pass / 0 fail；`bunx tsc -b` exit 0。
- 最终隔离临时 HOME 执行 `env -u NO_COLOR caffeinate -is bun run check` exit 0：1488 pass / 0 fail，7664 expect，112 files；日志 `/tmp/neant-checkpoint-05-final-check.log`。
- 固定审查点 `75f8559509ef5955af64271b4dbffe3292f01aae`；Standards / Spec 两轴独立审查结论见下方记录。

### Parent-coordinated code-review — 2026-10-05

- 审查实现提交 `d203750ab1c0c862049802d84d65e4bacc1496b2`，固定点 `75f8559509ef5955af64271b4dbffe3292f01aae`；父代理协调两个独立审查代理，分别执行 Standards / Spec 轴。
- Standards：0 hard violations / 0 possible smells。符合模块经 `index.ts` 导入与公开入口测试约束，正常启动 fixture 适配保留原有精确告警断言。
- Spec：0 missing / 0 scope creep / 0 incorrect。确认严格 mtime cutoff、当前 session（含旧 session resume）保护、缺失目录与删除失败仅告警，以及故障 fixture 显式禁用空目录预建均符合工单。
- Spec 审查代理独立重跑清理 e2e：5 pass / 0 fail，16 expect。
- 实现后的最终完整检查为 1488 pass / 0 fail，7664 expect，112 files，exit 0；本次收尾仅更新工单状态和审查证据，未修改实现。
- 工单验收项全部完成，状态置为 resolved；分支集成与 worktree 清理由父代理统一执行。

### Missing backup directory correction — 2026-10-05

- 用户实际启动时遇到 `file-history` 尚未创建触发的 `ENOENT` warning。此前“缺失目录也告警”的验收与实现记录由本次更正取代：从未产生备份的新建和恢复 Session 均应静默跳过，不提前创建备份目录。
- 产品改动仅在顶层 `readdir` 的 catch 中忽略 `ENOENT`；`ENOTDIR` 等真实读取失败和删除失败仍经 `onWarning` 告警。30 天边界、当前 Session 保护及其他目录清理行为不变。
- 公开 `createSession` + `fakeModel` 回归先更新原缺目录用例取得 red：4 pass / 1 fail，失败包含用户所见的同一 `ENOENT` warning；加入最小修复后 5 pass / 0 fail。再补充 resume 无备份和真实 `ENOTDIR`，清理 e2e 最终 7 pass / 0 fail，26 expect；`bunx tsc -b` exit 0。
- 独立 Standards / Spec 审查与最终完整检查证据将在完成后补充。
