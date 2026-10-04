# 05: `subagent_fork`

**What to build:** 模型调用 `subagent_fork { description, prompt, run_in_background? }`，创建一个带着父代理到最后一个已完成 turn 为止的消息的子代理（不含当前进行中的 turn）。复制来的消息写进子 transcript 自己的 entry，之后冷恢复不读父 session。系统提示、工具集（去掉子代理工具）、模型均与父相同，type 为 `fork`。其余行为（后台 / 前台、通知、限制、事件）同 `subagent`。

**Blocked by:** 02

**Status:** claimed

参考：[spec](../spec.md)「模型工具」。

- [x] e2e：fork 子代理的首次模型请求含父代理已完成 turn 的消息，不含当前 turn；父还没有已完成 turn 时从空历史开始
- [x] e2e：fork 使用父模型，即使设置了 `subagentModel`（若 04 尚未落地，此条在 04 合入后补上）
- [x] e2e：子 transcript 含复制来的消息
- [x] `tsc -b` 与全量 `bun test` 通过

## Comments

2026-10-04：已实现 `subagent_fork`，以 `turn_end` 保存父消息快照；同 Run 与跨 Run 的已完成 Turn 均可复制，当前 Turn 不进入子上下文。复制的消息追加为子 Transcript 自己的 entries。fork 固定继承父模型、System Prompt 和去掉四个委派工具后的工具集，复用 `subagent` 的运行、事件、通知、并发上限、usage 与权限路径。

公开验证：fork / subagent / permission e2e 31 tests 通过；`tsc -b` 通过；最终 `env -u NO_COLOR bun run check` 退出 0，1047 tests、5658 assertions。日志 `/tmp/neant-subagent-05-check-delivery.log`。CLI 的 `session_start` 工具列表预期已补入 `subagent_fork`。

完整检查发现 01 的小高度 Todo 测试把隐藏的 ActivityLine 当作 Run idle。临时断言重复 30 次均证明底部仍是 `esc 中断`；改为等待公开 StatusLine 的 interrupt 提示消失，重复 30 次通过、Todo 整文件 14 tests 通过，没有新增 sleep / timeout 或修改全局 helper。证据日志 `/tmp/neant-subagent-05-idle-race-red.log` 与 `/tmp/neant-subagent-05-idle-race-green.log`。

Status 保持 claimed，等待协调代理安排固定基点 `be017e67fbce56ee22848ed70257d69586179aa6` 的 Standards / Spec 两轴独立评审；评审通过后再 resolved 和 main 集成。
