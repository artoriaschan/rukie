# 08: 子代理 hooks

**What to build:** 子代理开始和结束时有 hook，结束时可以让子代理继续；子代理类型可以在 frontmatter 里声明只在自己运行时生效的 hooks。见 [spec](../spec.md)「接入：子代理」。

**Blocked by:** 01, 06

**Status:** ready-for-agent

- [ ] 子代理内工具类 hook 输入带 `agent_id`、`agent_type`。
- [ ] SubagentStart 在子 session 每次开始 run 前触发（含 `send_message` 唤醒），matcher 匹配 `agent_type`；`additionalContext` 附在子代理该次 user 消息上；不能阻断。
- [ ] SubagentStop 挂子 session 的 run 层，语义同 Stop（block 续跑、上限 8），输入另带 `agent_transcript_path`、`last_assistant_message`；父 session 在子代理真正结束后才收到通知。
- [ ] `agents/*.md` frontmatter 可声明 `hooks`（格式同 settings），`Stop` 改为 `SubagentStop`，只在该子 session 内生效；项目层目录的类型在非 trusted 时丢弃 hooks 并告警。
- [ ] Agent Core e2e 与 config / 子代理类型测试覆盖以上。
