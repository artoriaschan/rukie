# 03: 前台超时转后台

**What to build:** 前台 bash 超时后不再被杀，而是转为 Background Job，模型拿到 job id 后可以继续读取或终止。详见 [后台 bash spec](../spec.md) 的 bash 工具一节。

Blocked by: 02

Status: resolved

- [x] 超时后返回 `[still running after <s>s; moved to background job <id>]` 加 harness 的说明文字，进程继续运行
- [x] 转入后台不受每个 owner 10 个的上限限制
- [x] 在超时前结束的前台命令不出现在 `job_list` 里，结果格式与 01 一致
- [x] 前台调用被 abort 时仍然杀掉它的 job
- [x] 现有的"bash 超时返回错误"e2e 按新行为更新；新增 e2e：转入后台后 `job_output` 能读到后续输出，`job_kill` 能终止它

## Comments

2026-10-06: claimed on `codex/background-jobs-03` from verified ticket 02 integration `8cf73a8e01bc15463ac2fa149b2467f36546747f`. Tests use the spec-approved `createSession` + fake model seam with real controlled processes; notification wiring stays in ticket 04.

2026-10-06: red → green at the public seam: the original timeout case failed with `Command timed out after 0.05 seconds`, then passed with the promotion result and `details.jobId`; the output handoff regression failed with duplicated `beforeafter`, then passed after consuming the foreground output cursor. Focused `bun test packages/agent/tests/e2e/background-jobs.test.ts packages/agent/tests/e2e/bash.test.ts packages/agent/tests/e2e/tools.test.ts`: 41 pass / 0 fail; `bunx --no -- tsc -b`: exit 0.

2026-10-06: initial isolated-HOME `env -u NO_COLOR bun run check` completed with 2228 pass / 1 fail (2229 tests, 306.52 s): existing `zh_CN.UTF-8 dashboard captures all input and opens the keyboard-selected child detail` timed out at 5000 ms during concurrent aggregate checks. Immediate focused `bun test apps/neant-tui/tests/e2e/subagent-views.test.ts --test-name-pattern 'dashboard captures all input'`: en + zh 2 pass / 0 fail (316 ms / 246 ms). No unrelated TUI change; repeat the aggregate on verified ticket 04 integration before resolving.

## Answer

Foreground bash races process completion against its timeout. Reaching the deadline promotes the existing invisible job, detaches foreground streaming and cancellation, consumes the output already handed over, and returns the required marker/guidance with `details.jobId`; it never restarts the command or checks background-start capacity. Commands finishing before the deadline retain existing output/error/truncation behavior and leave no visible job. Foreground abort still terminates the process group; promoted jobs survive Run abort and remain readable/killable. The Agent README and timeout tool description now describe these semantics.

2026-10-06: merged verified ticket 04 integration `a95dfc6219582fc13572e9983424199f33d434df` into this branch before final verification. Public integration coverage additionally verifies that a timeout-promoted job completes while idle, starts exactly one notification Run through the original observer, and preserves its final output for `job_output`. Ticket 03 does not modify jobs registry or Session notification wiring.

Final verification: `bun test packages/agent/tests/e2e/background-jobs.test.ts packages/agent/tests/e2e/job-notifications.test.ts packages/agent/tests/e2e/bash.test.ts packages/agent/tests/e2e/tools.test.ts`: 49 pass / 0 fail, 187 assertions, 8.53 s. Isolated-HOME `caffeinate -is env -u NO_COLOR bun run check`: exit 0, format/lint/typecheck/Knip passed, 2237 pass / 0 fail, 11529 assertions across 162 files, 304.60 s. The previously timed-out TUI dashboard case passed in this final aggregate (en 243 ms / zh 239 ms). Standards/spec review of ticket 03 scope: no actionable findings; relative spec link, Markdown formatting and `git diff --check` verified.
