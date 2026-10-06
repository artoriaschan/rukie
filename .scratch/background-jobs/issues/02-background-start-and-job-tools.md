# 02: 后台启动与 job 工具

**What to build:** 模型可以用 `bash run_in_background` 启动 Background Job，用 `job_output` 增量读取、`job_list` 列出、`job_kill` 终止，session 结束时 job 被清理。这一张还不发结束通知。详见 [后台 bash spec](../spec.md) 的 Job registry、job 工具、生命周期三节。

**Blocked by:** 01

**Status:** resolved

- [x] Session 持有 job registry；id 为 `bash-N`；字段与状态按 spec
- [x] `run_in_background: true` 立即返回 `started background job <id>`，没有超时；每个 owner 第 11 个后台 job 返回上限错误
- [x] 输出分为 stdout / stderr 两个 ring（运行中 256 KiB，结束后 16 KiB），完整输出 spill 到 0700 目录
- [x] `job_output`：按模型游标返回增量，后接 `[stderr]` 段，末尾为状态行；没有新输出时返回 `(no new output)`；ring 丢过数据时附 spill 路径；`wait` / `timeout_ms`（默认 30 s，上限 10 min）
- [x] `job_list`、`job_kill`（整组终止，已结束的返回 already finished）；未知 id 返回 `unknown job <id>; background jobs do not survive a session restart`
- [x] 三个工具不需要审批，照常经过 hooks；`bash` 的规则、hooks、审批对 `run_in_background` 同样生效，hook 的 `tool_input` 里带该字段
- [x] run 结束或 abort 后后台 job 仍然活着；Session dispose 时终止全部 job 并删除 spill 目录；进程 `exit` 时同步 SIGKILL 兜底（手动验证并记录）
- [x] System Prompt 加入 harness `tool:jobs` 原文
- [x] e2e 覆盖以上各项与 resume 后对旧 id 的报错；用"等文件出现"控制命令何时结束

## Comments

2026-10-06: claimed in `codex/background-jobs-02` from verified ticket 01 base `a2c9fa0`. Public test seams follow spec; notification and timeout promotion remain tickets 04 and 03.

## Answer

Session 持有 `jobs` registry，所有 bash 复用一条 detached spawn 路径。前台记录对外不可见；显式后台启动带 `details.jobId`，后台任务跨 Run 保留。两个 UTF-8 ring 合计运行中 256 KiB、结束后 16 KiB；完整输出在 Session 专属 0700 目录下以 0600 日志 spill。三个 job 工具提供增量游标、等待、状态、上限与幂等终止；普通权限模式不询问，规则与 hooks 仍生效。

`clear()` 是可复用的子 Run 清理，`dispose()` 永久关闭 registry；清理覆盖前台已结束但仍活跃的同组后代，输出 drain 上限 3.1 秒。模块级单个 exit listener 只持有活跃进程组 id。等待取消不移动模型游标、不终止进程；成功的完成收集、模型 kill 与 teardown 记录 suppression。close 先唤醒收集者，再 resolve `completed`，后续通知必须在 completion Promise 之后判断 suppression。超时转后台、结束通知、公开 Session API 与 job 事件保持后续票归属。

验证证据：

- TDD 公共入口：首个后台启动测试先失败为 `Command timed out after 0.001 seconds`；Unicode tail 回归先产生替换字符；已结束前台 shell 的后代先在 dispose 后存活。三者均在实现后通过。
- `rtk proxy bun test packages/agent/tests/e2e/background-jobs.test.ts packages/agent/tests/e2e/bash.test.ts packages/agent/tests/e2e/tools.test.ts`：37 pass / 0 fail；新增后台测试 15 项覆盖文件控制时序、stdout/stderr、输出上限、退出码、进程树、取消、resume、模式、hooks、quota 与有界 dispose。
- `rtk proxy bun test packages/agent/tests/e2e/session-allow-rules.test.ts packages/agent/tests/e2e/background-jobs.test.ts`：33 pass / 0 fail。工具组装的两个直接测试显式创建并清理 registry。
- 新增工具声明增加初始上下文，保持 TUI compaction 与 review 断言不变，分别调整假模型预算为 5000 和 10000；review 的旧历史设为 1500 次，使其仍高于 review 半窗口、低于主模型压缩阈值。CLI session_start 精确工具列表加入三个 job 工具。相关聚焦测试分别 2 / 1 / 1 pass。
- 手动 exit 探针：启动真实 shell / child / grandchild，未调用 dispose，直接 `process.exit(17)`；父探针观察返回码 17，PID 54383、54384、54385 全部消失。探针与临时项目已清理。这验证 `exit` 同步 SIGKILL，不包含对 Neant 本身 `kill -9` 的情形。
- 首轮隔离 HOME 的完整检查：2221 pass / 4 fail；失败为 README 进入源码 Han 扫描、两项假模型预算、CLI 精确工具列表。四项已修正；最终 `env -u NO_COLOR HOME=<isolated temp home> caffeinate -is bun run check` 全部通过：format / lint / tsc / Knip 成功，2225 pass / 0 fail，11478 expect，161 files，296.70 秒。日志：`/tmp/neant-background-jobs-02-final-check.log`。
- `rtk proxy git merge --no-edit codex/background-jobs`：Already up to date，集成基线仍为 `a2c9fa0`。

2026-10-06: resolved。全部验收项与最终完整检查通过；实现与引用文档已对齐，已核对 diff 与最新集成基线。
