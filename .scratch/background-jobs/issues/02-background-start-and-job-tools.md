# 02: 后台启动与 job 工具

**What to build:** 模型可以用 `bash run_in_background` 启动 Background Job，用 `job_output` 增量读取、`job_list` 列出、`job_kill` 终止，session 结束时 job 被清理。这一张还不发结束通知。详见 [后台 bash spec](../spec.md) 的 Job registry、job 工具、生命周期三节。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Session 持有 job registry；id 为 `bash-N`；字段与状态按 spec
- [ ] `run_in_background: true` 立即返回 `started background job <id>`，没有超时；每个 owner 第 11 个后台 job 返回上限错误
- [ ] 输出分为 stdout / stderr 两个 ring（运行中 256 KiB，结束后 16 KiB），完整输出 spill 到 0700 目录
- [ ] `job_output`：按模型游标返回增量，后接 `[stderr]` 段，末尾为状态行；没有新输出时返回 `(no new output)`；ring 丢过数据时附 spill 路径；`wait` / `timeout_ms`（默认 30 s，上限 10 min）
- [ ] `job_list`、`job_kill`（整组终止，已结束的返回 already finished）；未知 id 返回 `unknown job <id>; background jobs do not survive a session restart`
- [ ] 三个工具不需要审批，照常经过 hooks；`bash` 的规则、hooks、审批对 `run_in_background` 同样生效，hook 的 `tool_input` 里带该字段
- [ ] run 结束或 abort 后后台 job 仍然活着；Session dispose 时终止全部 job 并删除 spill 目录；进程 `exit` 时同步 SIGKILL 兜底（手动验证并记录）
- [ ] System Prompt 加入 harness `tool:jobs` 原文
- [ ] e2e 覆盖以上各项与 resume 后对旧 id 的报错；用"等文件出现"控制命令何时结束
