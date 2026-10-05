# 02: 模型 goal 工具与收尾

**What to build:** 模型可以用 `create_goal` 根据用户的长任务请求替用户设 goal，也可以用 `update_goal` 修改、暂停、恢复 goal，或在完成时标记 complete、卡住时标记 blocked。在 goal round 内标记 complete / blocked 后，模型会在同一 run 里给用户写一段收尾说明。TUI 中这两个工具的卡片显示 goal 摘要，而不是原始 JSON。详见 [Goal spec](../spec.md) 的"模型工具"和"TUI 工具卡"两节。

**Blocked by:** 01 Goal 续跑核心

**Status:** ready-for-agent

- [ ] 仅顶层 session 注册 `create_goal { objective, max_goal_rounds? }` 与 `update_goal { action, objective?, blocked_reason? }`（Headless 也注册），不提供 `get_goal`
- [ ] 授权：create / edit / pause / resume 需当前 run 有直接人类输入（prompt 或 steer）；模型 resume 一个 paused 的 goal 时拒绝；complete / blocked 在直接人类输入或当前 goal round 内都可以
- [ ] run 中用户 pause 后，模型 complete 被接受，complete 覆盖 paused
- [ ] 参数组合校验：`objective` 仅 edit 有效；`blocked_reason` 仅 blocked 有效且必填；错误组合返回工具错误
- [ ] `create_goal` 不另起 run，当前 run 结束后由 driver 接手
- [ ] goal round 内 complete / blocked 成功后，追加带 goal 来源标记的收尾 user 消息（照搬 DSH `renderWrapupContext` 原文）；complete / blocked 都 disarm，不再开轮
- [ ] 工具结果为紧凑 JSON `{ goal: {...} | null, armed }`；工具 description 承载使用规范（照 DSH guidance 改写），不改 System Prompt
- [ ] TUI 工具卡渲染三行：`🎯 objective`、`<label> · n/max · armed|disarmed`，blocked 时加 `⛔ reason`；出错时按现有错误卡呈现
- [ ] Agent Core e2e 覆盖授权、参数校验、complete / blocked 收尾、上限；TUI 测试覆盖工具卡
