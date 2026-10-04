# 06: Stop hook 续跑

**What to build:** run 即将结束时 Stop hook 可以拦下并让模型继续（如"测试不过不许收工"），连续最多 8 次。见 [spec](../spec.md)「接入：Session 生命周期」。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 挂在 Session run 层（不挂 pi `finishTurn`）：pi agent 循环返回、无在跑子代理与未交付通知、最后一条 assistant 消息非中止非错误时触发；等待子代理期间不触发。输入带 `stop_hook_active`、`last_assistant_message`。
- [ ] `decision: "block"` + `reason` 或 exit 2：原因作为来源为 `stop_hook` 的 user 消息再跑一轮 agent 循环，仍在同一 run 内。
- [ ] `stop_hook_active` 在本 run 已因 Stop hook 续跑过时为 true；连续 block 到第 9 次时忽略、发 `hook_warning`、结束 run；新 run 重置计数。
- [ ] 新事件 `hook_continued { event, reason }`；TUI 把对应 user 消息标为"Stop hook 反馈"（双语）；进 stream-json。
- [ ] Stop 判定位于 Goal 之前的挂点（Goal 未实现，留注释说明顺序约定）。
- [ ] Agent Core e2e：一次续跑后放行、第 9 次被忽略；run 中派出子代理并等待时 Stop 只在子代理结束、run 收尾时触发一次。
