# 04: Headless `--goal`

**What to build:** Headless 用户可以运行 `neant --goal "<objective>" [--max-goal-rounds N]`，让 agent 无人值守地跑到 goal 结束；按结果给出退出码，脚本和 CI 可据此判断成败。详见 [Goal spec](../spec.md) 的"Headless CLI"一节。

Blocked by: 01 Goal 续跑核心，02 模型 goal 工具与收尾

Status: resolved

- [x] 新 flag `--goal <objective>` 与 `--max-goal-rounds <N>`；后者仅能与 `--goal` 同用且须为正整数，否则报错
- [x] `--goal` 与 `-p` 互斥，同时给出时报错
- [x] 流程：建立或 resume session → `createGoal` → 等待直到 goal 不再 armed
- [x] 退出码：complete 为 0；blocked（含超限）为 1；run 出错沿用现有错误退出码
- [x] `--resume <id> --goal`：该 session 已有非 complete goal 时报错并提示用 TUI 处理，不运行；没有 goal 或 goal 已 complete 时新建并跑完
- [x] text 输出逐轮打印 assistant 回答；stream-json 中出现 `tool_state_changed`（goal），不新增事件类型
- [x] 在 CLI e2e 中追加覆盖以上行为

## Answer

`apps/neant-cli/src/main.ts` 验证 Goal 参数后创建或恢复 Session；等待 SessionStart Hook autorun 空闲，再创建 Goal，并经 `waitForIdle()` 等待所有轮次及 complete / blocked 的同 Run 收尾。未完成 Goal 恢复冲突会提示使用 TUI。仅父 Session 的 result 负责逐轮 text 输出与失败退出码；stream-json 原样转发事件。Headless 仍不提供 Interaction 回调。

SIGINT 转交内部 Run；创建 Goal 后重新检查信号，防止信号在 Goal 告警与调度之间到达时错过中止。释放 Session 后等待外部空闲边界，确保中止消息落盘。退出码为 complete 0、blocked / 超限 / 失败 / length 1、参数错误 2、SIGINT 130。

## Verification

- TDD：首个超限进程回归先因未知 `--goal` 得到 2（预期 1）失败，再通过；多轮输出先得到两次固定回答和退出码 1，再扩展 fake OpenAI 脚本回复后通过；创建中 SIGINT 回归先观察到额外模型请求，再修复信号检查后通过。
- `rtk proxy bun test apps/neant-cli/tests`：117 pass / 0 fail。覆盖 complete / blocked 收尾、多轮文本、Goal 状态事件、参数校验、resume 三种情况、交互安全默认值、父子输出归属、Run error / length、startup autorun、中止创建与等待，以及进程 SIGINT 消息落盘。
- `rtk proxy bunx --no -- tsc -b`：exit 0。
- `rtk proxy env -u NO_COLOR bun run check`：exit 0，1786 pass / 0 fail，9395 断言、137 文件（211.01s）。
- 合入 integration `2f48b96` 后，`rtk proxy env -u NO_COLOR bun test apps/neant-cli/tests packages/agent/tests/e2e/goal.test.ts apps/neant-tui/tests/screens/chat/goal.test.ts`：149 pass / 0 fail；`rtk proxy bunx --no -- tsc -b`：exit 0。初次 focused 命令未清除 NO_COLOR，TUI chip 颜色断言失败；清除后通过。
- 最终 integration 的完整检查由主代理执行；本工作树额外完整检查日志 `/tmp/goal-04-check.log`。
