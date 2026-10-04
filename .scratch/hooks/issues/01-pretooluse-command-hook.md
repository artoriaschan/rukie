# 01: PreToolUse command hook（tracer）

**What to build:** 用户在 settings 里配置 PreToolUse command hook，工具调用前运行脚本；脚本可以拒绝、要求询问、放行或改写参数，改写后的参数仍要过权限规则。见 [spec](../spec.md)「配置」「匹配」「执行与协议」「接入：权限判定链」。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] settings schema 新增 `hooks.<Event>[]{matcher, hooks[]}`（本票只需 command handler，schema 按 spec 全量定义事件名与 handler 联合）；非法配置加载时报错并指出位置。
- [ ] 用户层总是加载；项目层仅 Trusted Project 加载，否则丢弃并告警；两层拼接（用户在前），按去重键去重。
- [ ] matcher：`*` / 空 / 省略 = 全部；仅 `[A-Za-z0-9_|,]` 为精确名或列表；其余为不锚定正则，非法正则加载报错。
- [ ] command 执行：`sh -c`（或 `args` exec），cwd = session cwd，环境带 `NEANT_PROJECT_DIR`；stdin JSON 含通用字段与 `tool_name` / `tool_input` / `tool_use_id`。
- [ ] 退出码：0 解析 JSON；2 阻断，原因取 JSON reason 或 stderr；其他为非阻断错误（stdout 为合法 JSON 时仍按 JSON）。
- [ ] 默认超时 600s，可按 hook 设 `timeout`（秒，可小数）；超时 / 崩溃 / 坏 JSON fail-open，并发 `hook_warning` 事件且走 `onWarning`。
- [ ] 多 hook 并行、共享原始输入；判定取最严 deny > ask > allow。
- [ ] hook deny 原因作为工具结果回给模型，`permission_denied` 带 `by: "hook"`；hook ask 在 full-access 下也询问；hook allow 跳过 Permission Mode 询问与 auto-review，但越不过规则 deny / ask。
- [ ] `updatedInput` 先按工具 schema 校验，非法则 deny 并说明；合法则原地改写，规则阶段按改写后参数判定；测试钉住 pi 复用 `args` 引用。
- [ ] `additionalContext` 截断到 10k 字符，作为 system reminder 附在这次工具结果上。
- [ ] `continue: false` 结束 run 并显示 `stopReason`；`systemMessage` 显示给用户。
- [ ] 子代理工具调用也触发（按引用共享配置）；内置、MCP、`skill` 工具都触发。
- [ ] Headless：hook 返回 ask 按 deny；`hook_warning` 进 stream-json（CLI 测试一条）。TUI：`hook_warning` 走现有告警，hook 拒绝的工具卡显示 `by: hook`；文案双语。
- [ ] Agent Core e2e 用真实 sh 脚本覆盖以上；config 测试覆盖信任闸门、去重、非法配置。
