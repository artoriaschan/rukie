# 04: 子代理写入归父 Checkpoint

**What to build:** `subagent` / `subagent_fork` 用文件工具写的文件，记入父 session 当前 Checkpoint（父 transcript 的 Tool State `checkpoint`）；回滚父 session 时一并还原。子 session 不建自己的 Checkpoint，也没有 rewind 入口。记录器随判定配置按引用传给子 session。见 [spec](../spec.md)"子代理"。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] 子代理写入的文件出现在父 `checkpoints()` 对应 prompt 下
- [ ] 父与子都写同一文件时只记首次写前内容
- [ ] 父 rewind 代码时还原子代理改动
- [ ] 子 session transcript 无 `checkpoint` Tool State
- [ ] 后台子代理在父 run 等待期间写入，仍归发起它的 prompt
- [ ] e2e 测试覆盖 `subagent` 与 `subagent_fork`

## Comments

### 2026-10-05 — Implementation prepared for review

- `createChild` 按引用传入父 session 的 Checkpoint 记录器；沿用既有放行后快照路径和串行记录，子 session 不开 Checkpoint、不写自身 `tool-state/checkpoint`。
- 公开 `createSession` / Session e2e 新增 13 个场景：两种子代理的 `write` / `edit`、父 transcript 持久化与事件、子 transcript 无 Checkpoint、父代码 Rewind、规范路径首次记录（父先/子先）、后台等待归发起 prompt、既有/恢复父 session 经 `send_message` 续跑、父与两子并发写同一文件。
- TDD：基线新测试 2 fail，文件实际写入但父 `checkpoints()` 的 files 为空；传递记录器引用后 2 pass，随后逐场景扩展至 13 pass。
- 定向验证：Checkpoint + subagent / fork 四文件 49 pass、0 fail；`bunx tsc -b` exit 0。
- 完整验证：临时隔离 `HOME`、移除 `NO_COLOR`、`caffeinate -is bun run check` exit 0；1496 pass、0 fail、112 files、7722 expect，169.70s。日志：`/var/folders/ql/gqv08x1d593_4fssr6n92gq80000gn/T/neant-checkpoint-04-check-59mq17bn/check.log`。
- 固定审查点 `75f8559509ef5955af64271b4dbffe3292f01aae`；Standards / Spec 独立审查待父代理发起，验收 checkbox 和 resolved 状态在审查后更新。
