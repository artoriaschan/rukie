# 05: Session API、job_event、用户停止与 Headless

**What to build:** frontend 能列出、读取、停止 job 并收到 job 事件；用户停止的 job 会告诉模型；Headless CLI 输出 job 事件，并在 run 结束时清理所有 job。详见 [后台 bash spec](../spec.md) 的 Session API 与事件、用户停止、Headless CLI 三节。

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Session 新增 `jobs()`、`readJob(id, offset)`（绝对偏移，不移动模型游标）、`killJob(id)`；类型放进 `@neant/shared`
- [ ] `job_event { kind: started | output | settled, job }`：job 成为后台 job 时才发 `started`，output 按约 150 ms 节流；前台命令不发
- [ ] `killJob` 生成 `User stopped background job <id> (<label>).`：run 进行中 steer 进去；空闲时排队随下一条 prompt 交给模型，不开新 run；该 job 不再发结束通知
- [ ] Headless CLI：stream-json 输出 `job_event`；text 模式不输出 job；`-p` / `--goal` 结束时终止全部 job，进程不挂起
- [ ] e2e（Agent Core + CLI `main.test.ts`）覆盖以上各项
