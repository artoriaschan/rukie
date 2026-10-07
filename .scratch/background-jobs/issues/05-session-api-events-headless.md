# 05: Session API、job_event、用户停止与 Headless

**What to build:** frontend 能列出、读取、停止 job 并收到 job 事件；用户停止的 job 会告诉模型；Headless CLI 输出 job 事件，并在 run 结束时清理所有 job。详见 [后台 bash spec](../spec.md) 的 Session API 与事件、用户停止、Headless CLI 三节。

Blocked by: 04

Status: resolved

- [x] Session 新增 `jobs()`、`readJob(id, offset)`（绝对偏移，不移动模型游标）、`killJob(id)`；类型放进 `@neant/shared`
- [x] `job_event { kind: started | output | settled, job }`：job 成为后台 job 时才发 `started`，output 按约 150 ms 节流；前台命令不发
- [x] `killJob` 生成 `User stopped background job <id> (<label>).`：run 进行中 steer 进去；空闲时排队随下一条 prompt 交给模型，不开新 run；该 job 不再发结束通知
- [x] Headless CLI：stream-json 输出 `job_event`；text 模式不输出 job；`-p` / `--goal` 结束时终止全部 job，进程不挂起
- [x] e2e（Agent Core + CLI `main.test.ts`）覆盖以上各项

## Comments

- 2026-10-06: `codex/background-jobs-05` 从集成基线 `a95dfc6` 开始实施，最终合入 03 后的 `fc33fd1`；测试 seam 为已批准的 `createSession` 与 CLI `main`。
- 将 `JobView`、`JobOutput`、`JobEvent` 放入 `@neant/shared`，Agent 公共入口同时导出。Session 暴露 `jobs` / `readJob` / `killJob`；Frontend 绝对字节偏移不移动模型游标，读取覆盖 stdout、stderr 与 dropped/spill。
- 后台启动和前台 timeout promotion 才发 started；output 约 150 ms 合并，最终 output 在 settled 前 flush。Session subscribe 在空闲期间继续观察，活跃 Run 的 onEvent 也接收事件；事件回调不阻塞进程 drain，await dispose 不形成自等待。
- 用户停止先抑制结束通知再发信号，活跃 Run steer，空闲排队到下一条人类 prompt 前；重复停止和已结束任务无额外消息。取消 Run 保留尚未交给模型的停止输入。
- 恢复后的编号从存储顺序下的普通 bash Tool Call / Tool Result 继续，扫描所有分支，涵盖 compaction、Rewind 与 Unknown Tool Outcome；不保存或重建任务。复现旧编号 bash-1 被新任务复用的失败后修复；旧 id 在新任务启动后仍 unknown，高编号结果后丢失的调用也会保留编号。
- CLI 已有通用事件序列化与 dispose 生命周期，无需新增执行路径。prompt / Goal × text / stream-json 四条 public main 路径验证后台进程在结束前退出，stream-json 包含 started/settled，text 只输出正常结果，不触发额外 Run。
- 更新 Agent README 的公开 API、观察与资源义务，以及 architecture 的 jobs/bash 归属和 Session 生命周期。
- TDD 红证据：未实现时 Session.jobs / killJob 不存在，started 事件为空；Resume 后新任务复用 bash-1。修复后相关 public 回归全部通过。
- 聚焦验证：`rtk proxy bun test packages/agent/tests/e2e/job-api.test.ts packages/agent/tests/e2e/background-jobs.test.ts apps/neant-cli/tests/main.test.ts`，75 pass / 0 fail / 323 assertions。
- 完整验证：隔离临时 HOME，并运行 `env -u NO_COLOR caffeinate -is bun run check`，exit 0；2254 pass / 0 fail / 11613 assertions / 163 files，297.98 s；format、lint、types、Knip 均通过。
- 本票不实现 TUI 呈现或子 Run 清理；它们分别由后续 07/08 与 06 消费本票公共契约。
