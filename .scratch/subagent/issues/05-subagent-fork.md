# 05: `subagent_fork`

**What to build:** 模型调用 `subagent_fork { description, prompt, run_in_background? }`，创建一个带着父代理到最后一个已完成 turn 为止的消息的子代理（不含当前进行中的 turn）。复制来的消息写进子 transcript 自己的 entry，之后冷恢复不读父 session。系统提示、工具集（去掉子代理工具）、模型均与父相同，type 为 `fork`。其余行为（后台 / 前台、通知、限制、事件）同 `subagent`。

**Blocked by:** 02

**Status:** ready-for-agent

参考：[spec](../spec.md)「模型工具」。

- [ ] e2e：fork 子代理的首次模型请求含父代理已完成 turn 的消息，不含当前 turn；父还没有已完成 turn 时从空历史开始
- [ ] e2e：fork 使用父模型，即使设置了 `subagentModel`（若 04 尚未落地，此条在 04 合入后补上）
- [ ] e2e：子 transcript 含复制来的消息
- [ ] `tsc -b` 与全量 `bun test` 通过
