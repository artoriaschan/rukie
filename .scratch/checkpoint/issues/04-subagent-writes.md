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
