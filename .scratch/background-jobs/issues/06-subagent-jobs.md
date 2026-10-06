# 06: 子代理的 job

**What to build:** 子代理可以在自己的 run 里起后台进程并管理它；子 run 结束时这些进程被清理，不影响父 session。详见 [后台 bash spec](../spec.md) 的子代理一节。

**Blocked by:** 05

**Status:** resolved

- [x] 子 session 有自己的 registry 和 owner，可以用 `bash run_in_background` 和 `job_*`，名额是它自己的 10 个；结束通知只发给子 session
- [x] 子 run 结束时（成功、失败、中止）以 teardown 取消它名下的 job，不通知、不唤醒子 session
- [x] 子 session 的 `job_event` 经 `subagent_event` 转发；父 session 的 `jobs()` 和 `job_list` 都不包含子代理的 job
- [x] e2e：子代理启动的 job 对父不可见；子 run 结束后进程已退出且没有通知；`send_message` 续跑时旧 job 已不存在

## Answer

子 Session 在 Run 的最外层 finally 清理自己的 registry，早于结果发布、运行占用释放与 rewake。registry 在发信号前抑制全部结束通知，子清理还关闭输出/事件回调并释放 ring；重叠 clear/dispose 共用一次进程收束，删除记录与 spill 目录后仍可续跑，保留递增编号。普通 Session 的任务与 dispose 事件保持原契约。复用现有子事件包装，没有扩展共享 JobView 或 Session 公共接口。生命周期说明同步到 Agent README、CONTEXT 与架构文档。

公开 e2e 覆盖成功/模型错误、子中断、父 Run 中断、父 dispose 与子 finally 重叠、父子各 10 个名额、自然完成只通知子模型、事件转发以及 send_message 续跑后的旧 id 错误。使用真实可控进程并在子 result 边界核对进程退出；父 jobs/job_list 与父进程始终独立。

## Comments

- 2026-10-06：已领取。使用 spec 批准的公开 `createSession`、工具结果、Session 事件与进程存活测试边界，先复现再实现。
- Red：成功/失败子 Run 发布结果后进程仍活着（2 fail）；接入 Run 清理后，teardown 仍发出 output/settled（2 fail）。修复清理前的事件/通知抑制后回归转绿。
- 相关最终版本回归：`bun test packages/agent/tests/e2e/subagent-jobs.test.ts packages/agent/tests/e2e/subagents.test.ts packages/agent/tests/e2e/subagent-fork.test.ts packages/agent/tests/e2e/subagent-outcomes.test.ts packages/agent/tests/e2e/subagent-hooks.test.ts packages/agent/tests/e2e/background-jobs.test.ts packages/agent/tests/e2e/job-api.test.ts packages/agent/tests/e2e/job-notifications.test.ts packages/agent/tests/e2e/session-dispose.test.ts apps/neant-cli/tests/main.test.ts`：139 pass、0 fail，10 个文件；其中新子任务测试 8 个。RTK 环境按项目规则加前缀。
- 完整检查中发现的测试类型收窄问题和普通 Session dispose 任务事件兼容问题已修复；CLI prompt/Goal 的 stream-json 保留 killed/settled 事件，子 Session teardown 静默。
- 最终完整检查：隔离临时 HOME，`env -u NO_COLOR caffeinate -is bun run check`，exit 0；格式、lint、类型、Knip 与测试通过，2262 pass、0 fail，11847 assertions、164 files，303.09 s。完整日志 `/tmp/neant-background-jobs-06-final-check.log`，相关回归日志 `/tmp/neant-background-jobs-06-focused.log`。
- Standards/Spec 自审未发现遗漏：清理由 Session/jobs 所有者实现，冻结的公共接口与泛型子事件包装未变，文档明确子 Run 生命周期例外。交付前 `git merge codex/background-jobs` 为 Already up to date，集成基线 `4c2e8257cc4b5943a1e9153ae7b410482a9197dc`；未合入 integration/main，未清理工作树。
