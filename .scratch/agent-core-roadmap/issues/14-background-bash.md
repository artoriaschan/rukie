# 14: 后台 bash

Type: grilling
Status: resolved
Blocked by: 02

## Question

长时间运行的进程（dev server、watch）怎么让模型启动、读取输出、杀掉？

需定：工具形态（bash 加 `background` 参数 + 读取 / 终止工具，还是独立 shell 会话工具）；输出缓冲上限与增量读取；进程生命周期与 session 的关系（run 结束、退出 TUI、resume 时进程如何处理，是否按地基 B 记录）；新输出是否作为 reminder 推给模型；TUI 呈现（后台任务列表）。

## Answer

2026-10-06 grilling 结论：照 deepseek-harness（`packages/shell/tool-bash`、`packages/jobs/`），TUI 复刻 dsh-TUI。术语 **Background Job** 已写入 `CONTEXT.md`，Run / Subagent 两条的 Avoid 已同步修改；bash 改为自研记入 [ADR-0010](../../../docs/adr/0010-own-bash-tool-for-background-jobs.md)。参考：harness 与 dsh-TUI 调研（本会话子代理），Claude Code 还原源码 `~/Workspaces/agent/claude-code` 作对照。

### 模型工具

1. **`bash`**：参数为 `command`、`description`（必填）、`timeout`、`workdir`、`run_in_background`。
   - 后台启动时返回 `started background job <id>`。
   - 前台默认超时 120 s，上限 600 s。超时后不杀进程，而是转入后台，返回 `[still running after …; moved to background job <id>]` 并附上 harness 的说明文字。
   - 后台 job 没有超时。
   - shell 状态不在调用之间保留，cwd 用 `workdir` 指定。
   - 不做 Ctrl+B 手动转后台。
2. **`job_output { job_id, wait?, timeout_ms? }`**：返回自上次读取以来的新增输出，末尾附 `[status: …]`；没有新输出时返回 `(no new output)`。`wait` 默认 30 s，上限 10 min。ring 丢过输出时附上 spill 文件路径，模型可以自己用 `read` 读完整内容。
3. **`job_list`**：每行 `<id> [bash] <status> — <label>`；没有 job 时返回 `(no background jobs)`。
4. **`job_kill { job_id, reason? }`**：返回 `requested cancellation of job <id>`，或返回该 job 已经结束。
5. **id 格式**：`bash-N`。
6. **系统提示段**：沿用 harness `tool:jobs` 的原文（"Track every background job id you start… job_kill jobs that stopped mattering."）。
7. **不做**：不按 Claude Code 让模型用 Read 读输出文件来替代 `job_output`；不做卡顿检测（交互提示等待）。

### 执行与输出

8. **执行路径**：只有一条。每条命令从启动起就登记为 job，前台调用只是等它结束，结束后从 registry 中删除。
   - 用自研 bash 替换 pi `createBashTool`，复用 pi 的 truncate 与 output-capture 工具函数（ADR-0010）。
   - 进程以 detached 方式启动，按进程组发信号：先 SIGTERM，3 s 后 SIGKILL。
9. **输出**：
   - stdout 与 stderr 分开采集，渲染时 stdout 在前，后接 `[stderr]` 段。
   - 内存 ring：运行中保留 256 KiB，结束后保留 16 KiB。
   - 完整输出 spill 到 0700 临时目录。
   - 模型和 frontend 各有自己的读取游标，互不影响。

### 生命周期与通知

10. **生命周期**：
    - run 结束或用户 Esc 中止 run 时，不杀后台 job。
    - 前台调用被 abort 时，连同它所在的 job 一起杀掉。
    - Session dispose 时终止全部 job，并挂 `process.on('exit')` 作兜底。
    - 不进 Tool State。
    - resume 后对旧 id 返回 `unknown job <id>; background jobs do not survive a session restart`。
11. **通知**：
    - 只在 job 结束（settle）时通知，有新输出时不通知。
    - 文本为 `background job <id> (bash: <label>) finished [status: …]. Read its output with job_output.`
    - 走 `scheduleRewake` 通道：run 进行中就 steer 进去，空闲时开新 run。
    - 以下情况不通知：已被 `wait` 收走、模型自己 kill、teardown。
    - 父 run 不等 job。
12. **用户手动停止**：`killJob` 注入英文消息 `User stopped background job <id> (<label>).`（Agent Core 不感知 locale）。run 进行中就 steer 进去；空闲时只排队，随用户下一条 prompt 一起交给模型，不开新 run。
13. **Headless**：stream-json 直接输出 `job_event`；text 模式不输出 job。run 结束时 kill 全部 job，不等它们结束。
14. **上限**：每个 owner 最多 10 个处于 running 或 stopping 的 job，超出时工具报错。

### 子代理与权限

15. **job 只管 bash。** harness 默认的 continuable 子代理本来就不登记 job，只有 one-shot 后台子代理才登记；Neant 没有 one-shot 模式，所以「子代理」工单不需要改。
16. **子代理名下的 job**：
    - 子代理可以使用 `bash run_in_background` 和 `job_*`。job 归子 session 所有，结束通知发给子代理自己，占子代理自己的 10 个名额。
    - 子 run 结束时（相当于 harness 子代理的 settle）以 teardown 取消它名下的 job，不发通知，也不会唤醒子 session。
17. **权限**：
    - 启动 job 照常经过 bash 的 hooks、规则和审批；规则 `bash(...)` 不区分前台和后台。
    - `job_*` 不需要询问，只能操作本 session 的 job。
    - hooks 的 `tool_input` 里带 `run_in_background`。

### Frontend

18. **事件与 API**：
    - 新事件 `job_event { kind: "started" | "output" | "settled", job }`，其中 output 按约 150 ms 节流。
    - Session 新增 `jobs()`、`readJob(id, offset)`（按绝对偏移读取，不移动模型的游标）、`killJob(id)`。
19. **TUI 复刻 dsh-TUI**：
    - statusline chip `● N`，hover 时列出各 job 及运行时长。
    - `/jobs` 打开 JobsPanel。Neant 没有侧栏，所以采用 dsh 窄屏的全屏 overlay，在 chat 屏幕内整屏 early return。
      - ↑/↓ 选择；`e` 展开详情，内容为输出尾部、时间线和 spill 路径。
      - `k` 按两次停止，4 s 内有效；Esc 关闭。
      - 不做 `s`（附到下一条消息）。
    - 转录中的 JobCard：`❯ cmd`、● / ✓ / ✗、2 行输出瀑布；点击打开面板并聚焦到该 job。
    - 连续 2 张及以上 JobCard 由 JobGroupHeader 折叠。
    - job 结束时弹 toast，6 s 后消失。

Spec：[后台 bash（Background Job）](../../background-jobs/spec.md)
