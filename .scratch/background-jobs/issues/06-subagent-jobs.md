# 06: 子代理的 job

**What to build:** 子代理可以在自己的 run 里起后台进程并管理它；子 run 结束时这些进程被清理，不影响父 session。详见 [后台 bash spec](../spec.md) 的子代理一节。

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] 子 session 有自己的 registry 和 owner，可以用 `bash run_in_background` 和 `job_*`，名额是它自己的 10 个；结束通知只发给子 session
- [ ] 子 run 结束时（成功、失败、中止）以 teardown 取消它名下的 job，不通知、不唤醒子 session
- [ ] 子 session 的 `job_event` 经 `subagent_event` 转发；父 session 的 `jobs()` 和 `job_list` 都不包含子代理的 job
- [ ] e2e：子代理启动的 job 对父不可见；子 run 结束后进程已退出且没有通知；`send_message` 续跑时旧 job 已不存在
