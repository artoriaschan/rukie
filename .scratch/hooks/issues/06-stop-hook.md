# 06: Stop hook 续跑

**What to build:** run 即将结束时 Stop hook 可以拦下并让模型继续（如"测试不过不许收工"），连续最多 8 次。见 [spec](../spec.md)「接入：Session 生命周期」。

**Blocked by:** 01

**Status:** resolved

- [x] 挂在 Session run 层（不挂 pi `finishTurn`）：pi agent 循环返回、无在跑子代理与未交付通知、最后一条 assistant 消息非中止非错误时触发；等待子代理期间不触发。输入带 `stop_hook_active`、`last_assistant_message`。
- [x] `decision: "block"` + `reason` 或 exit 2：原因作为来源为 `stop_hook` 的 user 消息再跑一轮 agent 循环，仍在同一 run 内。
- [x] `stop_hook_active` 在本 run 已因 Stop hook 续跑过时为 true；连续 block 到第 9 次时忽略、发 `hook_warning`、结束 run；新 run 重置计数。
- [x] 新事件 `hook_continued { event, reason }`；TUI 把对应 user 消息标为"Stop hook 反馈"（双语）；进 stream-json。
- [x] Stop 判定位于 Goal 之前的挂点（Goal 未实现，留注释说明顺序约定）。
- [x] Agent Core e2e：一次续跑后放行、第 9 次被忽略；run 中派出子代理并等待时 Stop 只在子代理结束、run 收尾时触发一次。

## Delivery / verification (2026-10-05)

- Stop 在 Session run 收尾层执行：先等待运行中的子代理并交付结束通知，再检查最后一条非 error / aborted assistant 消息；不挂 pi `finishTurn`，子 session 的 SubagentStop 留给 08。
- JSON block / exit 2 的原因以 `source: "stop_hook"` user 消息继续同一 run，来源保存到 transcript 并可 resume；`continue:false` 优先。每个新 run 重置计数，最多续跑 8 次，第 9 次忽略阻断并发出带共享错误码的告警。
- `hook_continued` 进入 stream-json；TUI 实时和恢复路径共用来源映射，反馈标签包含中文和英文。Goal 判定顺序注释已保留。
- 公开真实脚本 e2e 覆盖 JSON / exit 2、一次续跑放行、8 次上限和重置、子代理等待及通知交付、通用停止优先、多 hook 原因合并、assistant error / aborted 和反馈事件取消。反馈事件取消回归先 red（多一次模型调用），再 green（取消后不调模型、不写反馈消息）。
- Review base：`ba9d8e760d2fb36b7bfe2c2b3f6c2e84e008e736`；最终代码 HEAD：`8bc298aa9c10ad6485cf80d45522785ade9344bc`。Standards（独立 `standards_review_06`）及 Spec（独立 `hooks_05`）均 fresh 复核 0 findings；P2 取消边界和 P3 live / replay 重复映射已修复并复核。
- 完整验收：fresh 临时 HOME、清除 `NO_COLOR` 的 `bun run check` exit 0；格式 / lint / typecheck / knip 全通过，**1267 pass / 0 fail，6739 assertions，97 files**。日志：`/tmp/neant-hooks-06-delivery-check.log`。
