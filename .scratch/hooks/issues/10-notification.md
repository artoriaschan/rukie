# 10: Notification

**What to build:** agent 每次等用户（审批、提问、plan 评审、MCP 授权）时触发 Notification hook，用户可以借此发桌面通知。见 [spec](../spec.md)「接入：compaction 与交互」。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 地基 A 的共享交互 helper 在每次 Interaction 开始时触发，不等待结果。
- [ ] 输入带 `message`、`title`、`notification_type` = `permission_prompt` | `question` | `plan_review` | `mcp_auth`，matcher 匹配 `notification_type`；子代理发起的交互带 `agent_id`。
- [ ] 不能阻断；输出只认 `systemMessage`。
- [ ] Agent Core e2e：审批与提问各触发一次且类型正确，hook 慢时不阻塞交互。
