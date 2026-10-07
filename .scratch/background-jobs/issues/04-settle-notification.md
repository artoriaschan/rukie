# 04: 结束通知

**What to build:** Background Job 结束时 Agent Core 通知模型：run 进行中就插进下一个 turn，空闲时开一个新 run 让模型处理。详见 [后台 bash spec](../spec.md) 的结束通知一节。

Blocked by: 02

Status: resolved

- [x] 结束时生成 user 消息 `background job <id> (bash: <label>) finished [status: …]. Read its output with job_output.`，走 Session 现有的 rewake 通道（与 asyncRewake 同一路径，保留 observer）
- [x] 以下情况不通知：已被 `wait` 收走、模型 `job_kill`、teardown
- [x] 有新输出时不通知；父 run 不等 job
- [x] e2e：run 中结束 → 下一次模型请求里出现通知；空闲时结束 → 新开一个 run，原 observer 收到事件；三种不通知的情况各一个用例

## Comments

- 2026-10-06：在 `codex/background-jobs-04` 领取，基线 `8cf73a8e`；使用 spec 已批准的 `createSession` + 模型请求公共 seam，按 TDD 实现通知和抑制时序。

## Answer

Registry 在 `job.completed.then()` 中检查可见性、通知抑制与 dispose 状态，使完成释放的 wait 收集先提交抑制标记；取消 wait 仍允许随后通知。Session 将通知加入现有 `pendingRewakes`，沿用 `scheduleRewake` 的活跃 steer、空闲内部 Run、observer 保留和排队行为。前台记录和新输出不触发通知，README 已同步契约。

新增公共 e2e 覆盖活跃下一次请求、空闲 observer、完成后的 wait 收集、模型 kill、teardown、新输出不唤醒，以及取消 wait 后的完成通知。既有两项输出/取消测试改为等待自动收集 Run，避免与主动 Run 竞争。

### Verification

- Red：空闲完成用例在实现前因未发生 completion Run 超时失败（1 fail）；实现后通过。
- `bun test packages/agent/tests/e2e/job-notifications.test.ts packages/agent/tests/e2e/background-jobs.test.ts packages/agent/tests/e2e/async-hooks.test.ts`：35 pass / 0 fail。
- 隔离 HOME、`env -u NO_COLOR bun run check`：exit 0；2232 pass / 0 fail，162 files，11507 assertions；format、lint、types、Knip 均通过。
- 修改文档的 `oxfmt --check` 与 `git diff --check` 通过。
- Standards / Spec 自审：本票仅改通知路由与相应公共测试，没有新增运行路径；全部本票条件覆盖，无未解决发现。
- 本票在 02 已验证基线上交付；03 的超时 promotion 与完成通知组合由 03 合并本票后验证。
