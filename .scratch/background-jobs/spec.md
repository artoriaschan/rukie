Status: resolved

# Spec: 后台 bash（Background Job）

来源：[后台 bash](../agent-core-roadmap/issues/14-background-bash.md)。术语见 `CONTEXT.md` 的 Background Job、Session、Run、Subagent、Session Resume、Transcript；架构见 [ADR-0010](../../docs/adr/0010-own-bash-tool-for-background-jobs.md)（bash 改为自研）。参考：deepseek-harness `packages/shell/tool-bash`、`packages/jobs/jobs-local`、`packages/jobs/tool-jobs`；dsh-TUI `components/JobsPanel.tsx`、`components/Chat/JobCard.tsx`、`components/Chat/JobGroupHeader.tsx`、`screens/StatusLine.tsx`、`dsh-adapter/channel/job-projection.ts`。

## Problem Statement

我让 agent 起 dev server、跑 watch 或者一个要跑十几分钟的测试，现在只有两种结局：要么 bash 卡住整个 run 直到 120 s 超时被杀，要么模型自作聪明用 `&` 丢到后台，之后既读不到输出、也杀不掉，进程在我退出 Neant 后还挂着。模型没法"先起服务、再去改代码、回头看日志"；命令跑得比预期久时，前面等的时间全白费。TUI 里我也看不到当前有哪些进程在跑，想停只能自己去找 pid。

## Solution

bash 命令可以在后台运行，成为 Background Job：模型用 `run_in_background` 显式启动，或前台命令超时后自动转入后台而不是被杀。模型用 `job_output` 增量读取输出（可等待）、`job_list` 列出、`job_kill` 终止；job 结束时 Agent Core 通知模型，run 进行中直接插入，空闲时开新 run。job 跟随 session：run 结束不影响，session 结束时整组终止，不跨重启。TUI 在 statusline 显示运行中 job 数，`/jobs` 打开面板查看输出和停止，转录里每个 job 有一张卡片；Headless CLI 在 stream-json 中输出 job 事件，run 结束时清理所有 job。

## User Stories

1. As a TUI user, I want the agent to start a dev server in the background, so that it can keep editing code while the server runs.
2. As a TUI user, I want a foreground command that runs past its timeout to move to the background instead of being killed, so that a slow test suite is not wasted.
3. As a model, I want `bash` to return `started background job <id>` immediately when I set `run_in_background`, so that I can continue with independent steps.
4. As a model, I want the timeout result to tell me the job id and that I will be notified, so that I know the command is still running and how to read or stop it.
5. As a model, I want `job_output` to return only output produced since my last read, so that I do not re-read a growing log.
6. As a model, I want `job_output` to say `(no new output)` with the current status when nothing changed, so that I can tell "quiet" from "finished".
7. As a model, I want `job_output` with `wait` to block until new output or completion (default 30 s, max 10 min), so that I can wait on a job I am genuinely blocked on without busy-polling.
8. As a model, I want each `job_output` to end with `[status: …]` including the exit code once finished, so that I can judge success.
9. As a model, I want stderr shown in a separate `[stderr]` section after stdout, so that errors are easy to spot.
10. As a model, I want a spill file path when in-memory output was dropped, so that I can `read` the full log.
11. As a model, I want `job_list` to show every job I own with id, status, and label, so that I can recover ids after compaction.
12. As a model, I want `job_kill` to stop a job and its whole process tree, so that no orphan processes remain.
13. As a model, I want `job_kill` on an already-finished job to report its final status instead of erroring, so that cleanup is idempotent.
14. As a model, I want a notification when a job finishes, so that I do not need to poll.
15. As a model, I want no notification for jobs I killed myself or already collected with `wait`, so that I am not told what I already know.
16. As a model, I want an unknown or pre-restart job id to return a clear error saying background jobs do not survive a session restart, so that I re-run the command instead of retrying.
17. As a model, I want `workdir` on `bash`, so that I can run a command in a subdirectory without `cd` chains.
18. As a model, I want a clear error when I already have 10 running jobs, so that I clean up before starting more.
19. As a TUI user, I want a background job that finishes while the agent is idle to start a new run, so that the agent reacts to a crashed server without me prompting.
20. As a TUI user, I want a job that finishes during a run to be delivered into that run, so that the agent sees it at the next turn.
21. As a TUI user, I want ending a run or pressing Esc to leave background jobs running, so that my dev server survives an interrupted turn.
22. As a TUI user, I want Esc during a foreground command to kill that command, so that interrupting still stops what is in front of me.
23. As a TUI user, I want all jobs terminated when I quit Neant or switch session, so that nothing keeps running behind my back.
24. As a TUI user, I want jobs terminated even if Neant exits abnormally, so that ports are not left occupied.
25. As a TUI user, I want a statusline chip `● N` while jobs run, so that I always know something is still running.
26. As a TUI user, I want hovering the chip to list jobs with elapsed time, so that I can glance at them without opening a panel.
27. As a TUI user, I want `/jobs` to open a full-screen jobs panel, so that I can inspect all jobs.
28. As a TUI user, I want ↑/↓ to select a job and `e` to expand its output tail, timeline, and spill path, so that I can read its log.
29. As a TUI user, I want `k` pressed twice within 4 s to stop the selected job, so that I do not kill something by accident.
30. As a TUI user, I want Esc to close the panel and return to where I was reading, so that my scroll position is kept.
31. As a TUI user, I want the agent told when I stop a job from the panel, so that it does not wait for a job I killed.
32. As a TUI user, I want stopping a job while idle not to start a new run, so that the agent does not spring into action right after I intervened.
33. As a TUI user, I want a JobCard in the transcript under the bash call showing `❯ cmd`, status mark, and the last 2 output lines, so that I can follow progress inline.
34. As a TUI user, I want clicking a JobCard to open the panel focused on that job, so that I can jump to details.
35. As a TUI user, I want consecutive JobCards grouped under one header that collapses when all finish, so that many jobs do not flood the transcript.
36. As a TUI user, I want a short notice when a job finishes, so that I notice completion while reading elsewhere.
37. As a TUI user, I want the chip, panel, and cards to stay readable in a small terminal and after resize, so that nothing overflows.
38. As a TUI user, I want jobs started by a subagent to stay inside that subagent, so that the parent's job list only shows its own work.
39. As a model in a subagent, I want to run a server in the background and test against it within my run, so that I can verify my work.
40. As a parent session, I want a subagent's jobs cancelled when its run ends, so that delegated work does not leave processes running.
41. As a Headless CLI user, I want stream-json to include job events, so that scripts can observe background work.
42. As a Headless CLI user, I want all jobs killed when the run ends, so that `neant -p` never hangs on a dev server.
43. As a user with permission rules, I want background commands judged by the same `bash(...)` rules, hooks, and approvals as foreground ones, so that backgrounding is not a bypass.
44. As a hook author, I want `run_in_background` in `tool_input`, so that I can treat background commands differently.
45. As a model, I want `job_*` tools never to ask for approval, so that reading and stopping my own jobs is frictionless.
46. As a TUI user resuming a session, I want no ghost jobs shown, so that the UI reflects what is actually running.
47. As a frontend, I want `jobs()`, `readJob(id, offset)`, and `killJob(id)` on Session, so that I can render and control jobs without affecting the model's read cursor.
48. As a frontend, I want `job_event` with started / output / settled kinds, so that I can update the UI without polling.

## Implementation Decisions

- **Job registry（Agent Core 新领域目录，如 `jobs`）**：Session 持有一个 registry，按 owner（session id）登记 job。
  - job 字段：`id`（`bash-N`，按 session 递增）、`kind: "bash"`、`label`（`description`，没有时用截断后的命令）、`command`、`status`（`running | stopping | completed | failed | killed`）、`exitCode?`、`startedAt`、`endedAt?`、`spillPath?`。
  - 每个 owner 最多 10 个处于 running 或 stopping 的后台 job，超出时 `run_in_background` 的 `bash` 返回工具错误 `background job limit reached for this owner (limit: 10)…`。前台命令不占名额；超时转后台也不受上限限制，否则只能把它杀掉，所以数量可能短暂超过 10。
  - 输出：stdout 与 stderr 各一个内存 ring，运行中合计保留 256 KiB，结束后保留 16 KiB，丢弃最旧的部分。完整输出 spill 到 0700 临时目录（每个 session 一个子目录），session dispose 时删除。
  - 读取游标：模型一个（`job_output` 消费）；frontend 按绝对偏移读，不移动模型游标。
  - job 不进 Tool State，也不写 Transcript；Session Resume 后 registry 为空。
- **bash 工具（自研，替换 pi `createBashTool`，ADR-0010）**：
  - 参数：`command`、`description`（必填，3–10 词，用作 label 和卡片标题）、`timeout?`（秒，默认 120，上限 600）、`workdir?`（相对 session cwd 解析）、`run_in_background?`。
  - 执行路径只有一条：每条命令一启动就登记为 job（detached，独立进程组）。前台调用等待它结束；在超时前结束的从 registry 中删除，结果格式沿用现有前台 bash（截断规则、退出码非 0 时报错、`(no output)`）。
  - `run_in_background: true`：立即返回 `started background job <id>`，没有超时。
  - 前台超时：不杀进程，job 留在 registry 中，返回 `[still running after <s>s; moved to background job <id>]` 加 harness 的说明（`The command keeps running in the background. You will be notified when it finishes; read newer output with job_output, stop it with job_kill.`）。
  - 前台调用被 abort（Esc）：杀掉它的 job，结果为 `Command aborted`。已经在后台的 job 不受 run abort 影响。
  - 终止：向进程组发 SIGTERM，3 s 后发 SIGKILL。
  - 复用 pi 的 truncate 与 output-capture 工具函数；不改 read/write/edit。
  - 现有的权限判定、hooks、Checkpoint（bash 不追踪）、文件外部修改检测（bash 不追踪）、Unknown Tool Outcome 行为不变。
- **job 工具**：
  - `job_output { job_id, wait?, timeout_ms? }`：返回模型游标之后的增量，stdout 在前，有 stderr 时后接 `[stderr]` 段；末尾 `[status: running]`，或 `[status: completed, exit code: 0]` / `failed, exit code: N` / `killed`。没有增量时返回 `(no new output)` 加状态行。ring 丢过数据时加 `[some output was dropped from memory; full output: <path>]`。`wait: true` 时等到有新输出或 job 结束，等待上限为 `timeout_ms`（默认 30 000，上限 600 000）。在 job 结束后用 `wait` 收走，这个 job 不再发结束通知。
  - `job_list`：每行 `<id> [bash] <status> — <label>`；没有 job 时返回 `(no background jobs)`。
  - `job_kill { job_id, reason? }`：返回 `requested cancellation of job <id>`；已经结束的返回 `job <id> had already finished [status: …]`。模型 kill 的 job 不发结束通知。
  - 三个工具只能看到和操作本 session 的 job；未知 id 返回 `unknown job <id>; background jobs do not survive a session restart`。
  - 三个工具不经过审批，也不受 Permission Mode 和 Plan Mode 影响；照常经过 hooks。
  - System Prompt 增加一段 harness `tool:jobs` 原文：`Track every background job id you start. You are notified in-session when a job finishes — do not busy-poll or sleep on one; keep working on independent steps and do not duplicate a running job's work. Before giving a final answer, collect every still-relevant job with job_output (set wait: true only when you are genuinely blocked on it), and job_kill jobs that stopped mattering.`
- **结束通知**：
  - job 结束（settle）时生成一条 user 消息 `background job <id> (bash: <label>) finished [status: …]. Read its output with job_output.`，交给 Session 现有的 rewake 通道：run 进行中就 steer 进去；空闲时开一个新 run（与 asyncRewake 同一条路径，保留上一个 run 的 observer）。
  - 以下情况不通知：已被 `wait` 收走、模型 kill、teardown（session dispose、子 run 结束时的清理、Headless 结束时的清理）。
  - 有新输出时不通知。父 run 不等 job。
- **用户停止**：`session.killJob(id)` 终止 job，并生成 `User stopped background job <id> (<label>).`。run 进行中就 steer 进去；空闲时排队，作为前置消息随用户下一条 prompt 一起交给模型，不开新 run。这个 job 不再发结束通知。
- **生命周期**：
  - Session dispose 时以 teardown 终止它的全部 job，并等它们结束或超时。
  - 进程 `exit` 时，同步向所有活着的进程组发 SIGKILL 作兜底。
  - `/clear`、`/new`、切换 session、resume 都会 dispose 旧 Session，因此都会终止 job。
  - Rewind、compaction、切换模型不影响 job。
- **子代理**：
  - 子 session 有自己的 registry 和 owner，可以用 `bash run_in_background` 和 `job_*`，名额是它自己的 10 个；结束通知只发给子 session。
  - 子 run 结束时（无论成功、失败还是中止）以 teardown 取消它名下的 job，不通知，也不唤醒子 session。
  - 子 session 的 `job_event` 经现有的 `subagent_event` 包装转发；父 session 的 `jobs()` 不包含子代理的 job。
- **Session API 与事件**：
  - `jobs(): JobView[]`；`readJob(id, offset): { stdout, stderr, nextOffset, dropped }`（绝对偏移）；`killJob(id): Promise<void>`。
  - 新事件 `{ type: "job_event", kind: "started" | "output" | "settled", job: JobView }`，其中 output 按约 150 ms 节流，只带视图，不带输出内容（frontend 用 `readJob` 拉取）。
  - 前台命令在超时前结束时，不出现在 `jobs()` / `job_list` 里，也不发 `job_event`。job 只在成为后台 job 时（显式后台启动，或超时转后台）才对外可见，并发出 `started`，避免 dsh 那种前台命令短暂显示成 job 卡的问题。
  - 类型放在 `@neant/shared` 的 SessionEvent 联合中。
- **Headless CLI**：stream-json 原样输出 `job_event`（子代理的 job 在 `subagent_event` 里）；text 模式不输出 job 相关内容。run 结束（以及 `--goal` 结束）后，Session dispose 时终止全部 job，不等它们结束。
- **TUI（复刻 dsh-TUI）**：
  - statusline 在有 running 或 stopping 的 job 时显示 `● N`（N 为这两种状态的数量）；鼠标悬停时列出每个 job 的 label 和已运行时长。
  - 新增内置 Slash Command `/jobs`，run 进行中也可以用。它在 chat 屏幕内整屏 early return 出 JobsPanel（照 dsh 窄屏 overlay），和 subagent dashboard 的做法一致。
  - JobsPanel 列出本 session 的全部 job（结束的也保留到 session 结束）。
    - ↑/↓ 选择。
    - `e` 展开或收起详情：输出尾部（用 `readJob`）、时间线（started / promoted / settled 及时间）、spill 路径、丢数据提示。
    - `k` 第一次按下显示确认提示，4 s 内再按一次才调用 `killJob`。
    - Esc 关闭，回到 chat，阅读位置不变。
    - 不做 `s`。
  - JobCard：挂在发起它的 bash 工具卡下（显式后台调用，或超时转后台的调用）。内容为 `❯ <command>`、状态符号（运行中 ●，成功 ✓，失败或被杀 ✗）、最近 2 行输出；点击后打开 JobsPanel 并聚焦这个 job。
  - 连续 2 张及以上 JobCard 由 JobGroupHeader 合成一组，全部结束后折叠成一行摘要，Ctrl+O 展开。Ctrl+O 与 [TUI 工具卡](../agent-core-roadmap/issues/20-tui-tool-card.md) 的展开键同义，实现时确认不与现有绑定冲突。
  - job 结束时用现有 notice 显示 `后台任务完成：{{label}}（{{id}} · 用时 {{duration}}）`（失败或被杀时用对应文案），约 6 s 后消失。
  - 文案进 TUI 字典，zh 和 en 同步。
- **i18n**：Agent Core 发给模型的文本固定为英文（ADR-0008）；用户可见的错误码（如 job 上限）按现有 UserVisibleErrorData 走 `@neant/i18n`。

## Testing Decisions

- **好测试**：只测外部行为。
  - Agent Core 看这些：模型请求里的工具结果文本、注入的通知消息、新开的 run、`jobs()` / `readJob()` / `job_event`、进程是否真的退出（用 pid 存活检查或子进程写的标记文件）、resume 后的 Transcript。
  - TUI 看终端画面和传给 Session 的调用。
  - 不测 ring buffer、游标、节流等内部结构。
- **时序**：用真实进程，不加时钟或 spawn 注入点。命令由测试控制何时结束：等某个文件出现（`while [ ! -e go ]; do sleep 0.01; done`）或读 fifo；不靠 sleep 猜时间。要测超时转后台时，传一个很小的 `timeout`（如 0.05）。被终止的命令必须能响应 SIGTERM，避免多等 3 s 补发的 SIGKILL。
- **Agent Core e2e**（`bun:test`，`createSession` + `fakeModel` + `tempDirs`，新文件如 `tests/e2e/background-jobs.test.ts`；子代理部分可以放进现有的 subagents 测试旁边）：
  - `run_in_background` 立即返回 `started background job bash-1`，run 继续；`job_list` 列出它。
  - 前台超时转后台：结果是 promoted 文案，进程仍然活着；命令随后结束时，模型收到结束通知。
  - 前台命令在超时前结束：结果格式和现在一样，`jobs()` 为空，没有 `job_event`。
  - `job_output` 增量：两次读取之间新产生的输出只出现一次；没有新输出时返回 `(no new output)`；`[stderr]` 段；结束后的状态行带退出码；`wait` 能等到输出或结束，并在 `timeout_ms` 到期时返回；用 `wait` 收走后不再通知。
  - 输出超过 ring 上限：附带 spill 路径，文件里是完整输出。
  - `job_kill`：进程组（包括孙进程）被终止；已经结束的 job 返回 already finished；被 kill 的 job 不通知。
  - 通知：run 进行中结束的 job 被 steer 进下一个 turn；空闲时结束的 job 开一个新 run，并带上原 observer（照 `async-hooks.test.ts` 的 asyncRewake 用例）。
  - run 结束或 abort 后后台 job 仍然活着；Esc 中止前台命令时，那条命令被杀。
  - `session.killJob`：run 进行中收到 steer 消息；空闲时不开新 run，消息随下一条 prompt 进入模型请求。
  - `readJob(offset)` 不影响模型随后 `job_output` 的增量。
  - `dispose` 后所有进程退出，spill 目录被删除。
  - Session Resume 后 `jobs()` 为空；`job_output` 旧 id 返回 unknown job 错误。
  - 上限：第 11 个 `run_in_background` 返回错误；超时转后台不受上限限制。
  - 子代理：子代理启动的 job 不出现在父 `jobs()`，它的 `job_event` 包在 `subagent_event` 里；子 run 结束后，它的进程被终止且没有发出通知。
  - 权限：`bash` deny 规则对 `run_in_background` 同样生效；PreToolUse hook 的 `tool_input` 带 `run_in_background`；`job_*` 在 default Permission Mode 下不询问。
  - `workdir` 相对 session cwd 解析。
- **Headless CLI**（`apps/neant-cli/tests/main.test.ts`）：stream-json 输出里有 `job_event`；`-p` 中启动的后台 job 在进程退出前被终止，CLI 不挂起。
- **TUI e2e**（`start` + `controlledModel` + headless terminal，新文件如 `tests/e2e/jobs.test.ts`）：
  - 后台 job 运行时 statusline 显示 `● 1`，结束后消失；悬停显示 label 和时长。
  - bash 工具卡下出现 JobCard：命令、● → ✓ / ✗、最近 2 行输出；点击打开 JobsPanel 并聚焦这个 job。
  - 连续两个 job 显示成一组，全部结束后折叠；Ctrl+O 展开。
  - `/jobs`：↑/↓ 选择，`e` 展开详情，`k` 按一次只出现确认提示，4 s 内再按一次停止 job（Session 收到 `killJob`），Esc 返回后阅读位置不变；run 进行中也能打开。
  - job 结束时出现 notice。
  - 小终端（40×12）和 resize 下 chip、面板、卡片不溢出。
  - zh / en 文案都有（`locale.test.ts` 的现有模式）。
- **参考先例**：Agent Core `tests/e2e/tools.test.ts`（bash 超时、abort 杀子进程）、`async-hooks.test.ts`（rewake 开 run、steer）、`session-dispose.test.ts`、`session-recovery.test.ts`、`subagents.test.ts`、`bash-permission-rules.test.ts`、`hooks.test.ts`；TUI `subagent-panel.test.ts` / `subagent-views.test.ts`（整屏面板和按键）、`status-line.test.ts`、`tools-and-notices.test.ts`、`fullscreen.test.ts`。
- 进程 `exit` 时的同步 SIGKILL 兜底不做自动化测试，实现时手动验证（kill -9 Neant 不在此列），结果记录在工单中。

## Out of Scope

- Ctrl+B 把运行中的前台命令转到后台。
- 卡顿检测（输出停住且停在交互提示上时提醒模型）。
- 子代理作为 job（one-shot 后台子代理）；子代理继续使用 `list_agents`、`send_message` 和现有通知。
- 持久化 job、跨重启恢复；Headless 等待后台 job 结束。
- 有状态的 shell（cwd / env 在调用之间保持）、PTY / 交互式命令。
- job 的 `filter` 正则；用 Read 读输出文件代替 `job_output`。
- JobsPanel 的 `s`（把摘要附到下一条消息）和侧栏模式。
- Linux systemd scope 等更强的进程树隔离。

## Further Notes

- 进程组终止只覆盖没有 `setsid` 的后代进程；自己脱离进程组的 daemon 杀不到。这和 harness 在 macOS 上的限制相同。
- 各项数值（256 KiB / 16 KiB ring、10 个 job、30 s wait、120 / 600 s 超时）都取自 harness 的默认值，后续按需要调整，不暴露成配置。
- 结束通知走 rewake 通道，所以会和 asyncRewake、Goal 续跑排同一个队，与它们的先后关系沿用现有的 `scheduleRewake` 顺序。
- JobCard 的样式以后可以并入 [TUI 工具卡](../agent-core-roadmap/issues/20-tui-tool-card.md) 的 terminal 卡统一。

## Answer

2026-10-06：全部实现集成到 `codex/background-jobs`，8 张工单均为 resolved：[01](issues/01-own-bash-tool.md)、[02](issues/02-background-start-and-job-tools.md)、[03](issues/03-foreground-timeout-promotion.md)、[04](issues/04-settle-notification.md)、[05](issues/05-session-api-events-headless.md)、[06](issues/06-subagent-jobs.md)、[07](issues/07-tui-chip-jobcard-notice.md)、[08](issues/08-tui-jobs-panel.md)。当前能力和调用方义务见 [Agent Core README](../../packages/agent/README.md)、[TUI README](../../apps/neant-tui/README.md) 与 [renderer README](../../packages/tui/README.md)。

交付覆盖自研 bash 的显式后台启动和前台超时转后台、owner 隔离与增量输出、结束通知和用户停止、Session 与子 Run 清理、Headless 事件与退出清理，以及 TUI 的 chip、JobCard、分组、notice 和 `/jobs` 面板。面板返回通过稳定阅读锚点保留阅读位置，并覆盖任务组折叠、Rewind、窄终端和 resize。

### Standards

双语退出码标签、未消费的完成记录字段、重复进程组清理分支均已修复；复核发现的 Hook JSON 输入收窄也已补齐。最终复核无剩余问题。

### Spec

初次审查公开复现了显式规则或 PreToolUse ask 仍触发 job 工具审批的问题。三个精确 job 工具现跳过审批交互，保留规则与 Hook deny、参数改写与校验、取消和停止；后台 bash 的审批流程不变。权限与 Hook 文档已同步，公开复现和相关回归通过，最终复核无剩余问题。

### Verification

最终修复源提交为 `54538f547248bfdaa6429629d058419698ab6a51`，最后一次实现集成为 `57e839985a32555a14410e19336fb5a1e43d33ea`。两者 Git tree 均为 `de7318c4766c8d8ca59089e192b9cb7ab99f3890`；合入后 `git diff --check` 通过，工作树干净。

冻结源码与测试，以隔离临时 HOME 运行 `caffeinate -is env -u NO_COLOR bun run check`，实际 exit 0：format、lint、types、Knip 成功，2300 pass / 0 fail，12077 assertions，166 files，测试用时 328.26 s。日志为 `/tmp/neant-background-jobs-review-final-check.log`；提交后的源码与测试指纹仍与完整检查输入一致。合入后的 Agent Core 后台任务与 TUI 面板重点回归为 48 pass / 0 fail，229 assertions，18.23 s。各阶段的红绿回归、进程 exit 手动验证和历史完整检查证据保留在对应工单中。

### Main integration

2026-10-06：按用户要求合入 `main`。主分支基线为 `c53bd5c0361fd41963e2704178212b21ea760eef`，后台任务分支为 `c4a0aef18111dafa2ef3ba280a3f14358c884f9b`。8 个冲突文件保留了主分支 MCP OAuth 与后台任务的两套现有行为，包括公共导出、Session 清理、notice 的 report / truncate、两种通知、`/mcp` 与 `/jobs` 命令及双语文案。

首次组合回归 238 pass / 6 fail：5 项为新增两个命令后的旧目录数量与导航预期，1 项为 MCP 审批 fixture 缺少 bash 必填 description。测试输入和预期已按合并后的公开契约更新，新增公开 TUI 场景验证 MCP 报告、任务卡片、面板返回、完成 notice 和 40×12 resize 共存；相关 45 个测试通过，强化实际输出断言后的共存场景也通过。失败日志保留在 `/tmp/neant-background-jobs-main-focused-before-expectations.log`。

合并候选源码冻结后，以隔离临时 HOME、清除 NO_COLOR 并启用 caffeinate 运行 `bun run check`，实际 exit 0：format、lint、types、Knip 成功，2409 pass / 0 fail，12503 assertions，173 files，363.68 s。日志 `/tmp/neant-background-jobs-main-full.log`。完整检查前后的 414 个源码、测试和文档文件指纹一致；其后仅追加本节验证记录，Markdown 格式与 diff 检查通过。
