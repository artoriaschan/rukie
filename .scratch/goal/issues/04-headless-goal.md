# 04: Headless `--goal`

**What to build:** Headless 用户可以运行 `neant --goal "<objective>" [--max-goal-rounds N]`，让 agent 无人值守地跑到 goal 结束；按结果给出退出码，脚本和 CI 可据此判断成败。详见 [Goal spec](../spec.md) 的"Headless CLI"一节。

**Blocked by:** 01 Goal 续跑核心，02 模型 goal 工具与收尾

**Status:** ready-for-agent

- [ ] 新 flag `--goal <objective>` 与 `--max-goal-rounds <N>`；后者仅能与 `--goal` 同用且须为正整数，否则报错
- [ ] `--goal` 与 `-p` 互斥，同时给出时报错
- [ ] 流程：建立或 resume session → `createGoal` → 等待直到 goal 不再 armed
- [ ] 退出码：complete 为 0；blocked（含超限）为 1；run 出错沿用现有错误退出码
- [ ] `--resume <id> --goal`：该 session 已有非 complete goal 时报错并提示用 TUI 处理，不运行；没有 goal 或 goal 已 complete 时新建并跑完
- [ ] text 输出逐轮打印 assistant 回答；stream-json 中出现 `tool_state_changed`（goal），不新增事件类型
- [ ] 在 CLI e2e 中追加覆盖以上行为
