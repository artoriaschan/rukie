# 04: 结束通知

**What to build:** Background Job 结束时 Agent Core 通知模型：run 进行中就插进下一个 turn，空闲时开一个新 run 让模型处理。详见 [后台 bash spec](../spec.md) 的结束通知一节。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] 结束时生成 user 消息 `background job <id> (bash: <label>) finished [status: …]. Read its output with job_output.`，走 Session 现有的 rewake 通道（与 asyncRewake 同一路径，保留 observer）
- [ ] 以下情况不通知：已被 `wait` 收走、模型 `job_kill`、teardown
- [ ] 有新输出时不通知；父 run 不等 job
- [ ] e2e：run 中结束 → 下一次模型请求里出现通知；空闲时结束 → 新开一个 run，原 observer 收到事件；三种不通知的情况各一个用例
