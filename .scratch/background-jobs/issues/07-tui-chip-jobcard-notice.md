# 07: TUI statusline chip、JobCard 与结束 notice

**What to build:** TUI 用户在 statusline 看到运行中 job 的数量，在转录里看到每个 job 的卡片和实时输出，job 结束时有提示。照 dsh-TUI 复刻。详见 [后台 bash spec](../spec.md) 的 TUI 一节。

Blocked by: 05

Status: resolved

- [x] statusline 有 running / stopping 的 job 时显示 `● N`，悬停列出 label 和已运行时长
- [x] JobCard 挂在发起它的 bash 工具卡下（显式后台调用或超时转后台）：`❯ <command>`、● / ✓ / ✗、最近 2 行输出（经 `readJob`）
- [x] 连续 2 张及以上 JobCard 由 JobGroupHeader 合成一组，全部结束后折叠成一行摘要，Ctrl+O 展开；确认不与现有按键冲突
- [x] job 结束时用现有 notice 提示，约 6 s 后消失，完成、失败、被杀分别用对应文案
- [x] zh / en 文案同步
- [x] TUI e2e：chip 出现和消失、卡片状态和输出更新、合组与折叠、notice；40×12 与 resize 下不溢出

## Implementation

- JobCard 以正常 bash 结果中经过验证的 `details.jobId` 关联当前 Session registry；CompletedEntry 保留 `toolCallId`、工具名与 args。先到的 started 事件缓存视图，历史 Transcript 结果不重建任务；公开 resume 用例验证同命令的新 job 不附到旧卡片。
- JobCard 经独立绝对游标读取输出，保留有界尾部，先按终端列宽与完整 grapheme 换行，再取最后 2 个视觉行。显式后台与超时提升共用投影，控制字符与 ANSI 被过滤。
- StatusLine 的 `● N` 保留在窄屏必需字段预算中，统计 running / stopping；hover 使用共享时长格式。只在活任务存在时添加 idle 时钟；全部结束后停止该时钟。安静进程的 stopping 视图在 `job_kill` 结果边界重新读取 registry。
- 连续 job 卡合组，全部结束后折叠；Ctrl+O 和标题点击展开，Ctrl+O 尊重模态路由，失败/停止计数优先显示。40 列采用紧凑分隔符，失败仍显示 error 色。
- 最新 job 结束通知沿用 Notice 样式，一行截断、6 秒过期；完成、失败和停止分别本地化。其他 notice 的生命周期不变，过期与 resize 保持阅读位置。
- 08 接口：`JobCard.onOpen(id)`、conversation 的 `JobRow` 输出/游标及 `refreshJobs()`；frontend 发起 kill 后应同步刷新 stopping 快照。完整 JobsPanel 与 `/jobs` 仍归 08。

## Verification

- 已观察 public terminal RED：最初没有卡片/chip；长 Unicode 输出被截掉尾部；失败通知长 label 挤压输入框；40 列折叠摘要截掉失败状态；安静停止中的任务未更新状态；40×12 notice + Todo + question 共存使 footer 丢一行。对应修复后 GREEN。
- `env -u NO_COLOR bun test apps/neant-tui/tests/e2e/background-jobs.test.ts`：9 个 job e2e 用例在最终 aggregate 全部通过；其中 40×12 notice + Todo + question 共存用例单测亦通过；包含 chip、idle hover 时钟、模型游标隔离、显式/提升、stopping、resume、分组/点击/Ctrl+O、提问共存、350 次 microtask 流式更新、输出 unread、阅读位置/草稿、40×12 与 resize、通知过期。
- `env -u NO_COLOR bun test apps/neant-tui/tests/e2e/background-jobs.test.ts apps/neant-tui/tests/e2e/streaming-burst.test.ts apps/neant-tui/tests/e2e/status-line.test.ts apps/neant-tui/tests/e2e/question-panel-parity.test.ts`：61 pass / 0 fail / 416 assertions（新增窄屏摘要测试前）。首次未清除继承的 NO_COLOR，5 个既有颜色断言失败；清除后全部通过。
- `bunx --no -- tsc -b`、`bunx --no -- oxlint`、`bunx --no -- knip`、修改文件 oxfmt 与 `git diff --check` 通过。
- 已 fast-forward 到经验证的 06 集成基线 `098d8af8116af37ce2ac803864ab634d8ef00851`。父任务审阅当前 projection/cards/notice/README diff，无新增阻塞项；全分支 Standards / Spec 审阅在 08 后进行。
- 最终代码树：隔离 HOME、`caffeinate -is env -u NO_COLOR bun run check` 全部通过，exit 0，2271 pass / 0 fail / 11909 assertions，165 个测试文件，312.55 s。格式 → lint → types → Knip → tests 均成功。日志 `/tmp/neant-background-jobs-07-full-check-final.log`；此前完整检查基线亦通过（2270 / 0 / 11903），发现共存预算问题后未用旧结果交付。

- 父任务复查最终高度预算修复，无新增阻塞项；ticket 07 resolved，未合入 main/集成分支或清理 worktree。
