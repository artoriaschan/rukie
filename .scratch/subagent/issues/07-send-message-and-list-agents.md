# 07: 续跑与子代理目录

**What to build:**

- `send_message { agent_id, message }`：只能发给本父 session 的子代理。目标正在运行时 steer 进去；空闲时开一个后台 run，按通知规则交回；返回 `delivered to <id>`。错误 id，或目标空闲且 running 已满时报错。
- `list_agents`：每行 `<id> [running|idle] — <description>`，没有子代理时返回 `(no subagents)`。
- 父 session 记 Tool State `subagents: [{ id, description, type }]`，version 1。resume 父 session 后全部为 idle，`send_message` 以子 session id 冷恢复，沿用原类型配置；类型已删除时回退 `general-purpose` 并告警。
- TUI：`send_message` 发起的 run 的卡片挂在该 `send_message` 工具卡下；父 session resume 时从 Tool State 初始化 idle 条目。

**Blocked by:** 02, 06

**Status:** ready-for-agent

参考：[spec](../spec.md)「模型工具」「Tool State 与 resume」。

- [ ] e2e：给运行中的子代理 steer（子代理下一次模型请求可见）；给空闲的子代理开新 run 并通知
- [ ] e2e：错误 id 报错；不能发给其他父 session 的子代理
- [ ] e2e：`list_agents` 输出；resume 父 session 后全部为 idle，`send_message` 冷恢复且子代理保留原历史
- [ ] TUI e2e：`send_message` 工具卡下出现对应卡片
- [ ] `tsc -b` 与全量 `bun test` 通过
