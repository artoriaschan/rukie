# 04: UserPromptSubmit 与 SessionStart

**What to build:** 用户提交 prompt 时 hook 可以拦下它或附加上下文；session 开始时 hook 可以注入项目状态。见 [spec](../spec.md)「接入：Session 生命周期」。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] UserPromptSubmit 在写入 user 消息前触发，输入带 `prompt`，默认超时 30s。
- [ ] `decision: "block"` 或 exit 2：不写 transcript、不调模型，run 以 `RunResult` 新分支 `hook_blocked`（带原因）结束；CLI 与 TUI 显示原因。
- [ ] `additionalContext` 与纯文本 stdout 作为 system reminder 附在该 user 消息上。
- [ ] Goal、子代理通知等 Agent Core 自己注入的 user 消息不触发。
- [ ] SessionStart 在 `source` = startup / resume / fork 时触发一次，matcher 匹配 `source`，输入带 `model`；`additionalContext` 与纯文本 stdout 附在下一条 user 消息上；不能阻断。
- [ ] Agent Core e2e 覆盖拦截、注入、resume / fork 的 source；CLI 测试 `hook_blocked` 输出。
