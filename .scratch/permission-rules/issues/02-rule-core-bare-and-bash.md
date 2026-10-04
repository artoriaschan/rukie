# 02: 规则核心：裸名与 bash 规则

**What to build:** 用户在 `~/.neant/settings.json` 写 `permissions.{allow,ask,deny}`，用裸工具名 glob 或 `bash(pattern)`（这一张先只按单条命令匹配整串）放行、询问或拒绝工具调用。deny 和 ask 规则在所有 Permission Mode 下都生效；ask 规则在 auto-review 下直接问用户，不发起 review；allow 规则跳过询问和 review；按 deny > ask > allow 取最严。被规则拒绝时，模型收到 `Denied by permission rule: <规则>`；`permission_denied` 事件带 `by: "rule" | "user" | "review"` 和可选的 `rule`，stream-json 自动带出，TUI 工具卡显示规则原文。规则写错（未知工具带 specifier、空串、括号不闭合）时，加载报错并指出文件和规则。本工单不动 `allowTools`（expand）。

**Blocked by:** 01

**Status:** ready-for-agent

参考：[spec](../spec.md)「Permission Rule」「拒绝反馈」；User Stories 1–3、7–8、14–18、27–29、36–37、42。

- [ ] shared 的 settings schema 新增 `permissions`；规则在加载时解析为结构化形式
- [ ] 规则判定纯函数作为新测试接缝，表驱动覆盖裸名 glob、bash glob（`*` 可跨空格、去掉首尾空白）、取最严、语法错误
- [ ] e2e：deny 在 full-access 下仍拒；ask 规则在 full-access 下仍问；ask 规则在 auto-review 下不发起 review；allow 规则在 ask 模式下不询问
- [ ] e2e：规则拒绝的 tool result 文案，以及 `permission_denied` 的 `by` / `rule`；用户拒绝与 review 拒绝分别带 `by: "user"` / `"review"`
- [ ] Headless 下命中 ask 规则时按 deny 处理，stream-json 带 `by`
- [ ] TUI 工具卡在 `by: "rule"` 时显示规则原文（i18n）
- [ ] `tsc -b` 与全量 `bun test` 通过
