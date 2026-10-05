# 01: 命令框架与补全菜单

**What to build:** TUI 里输入 `/` 弹出补全菜单，列出内置 Slash Command 和用户可调用的 skill；内置命令由 frontend 执行，其余 `/` 输入原样交给 Agent Core（Skill Invocation 或普通 prompt）。本工单交付命令表、补全菜单、run 中可用性规则，以及不需要新 Agent Core API 的命令：`/help`、`/exit`、`/clear`、`/plan`、`/rewind`、`/goal`（占位）。其余命令（`/compact`、`/model`、`/resume`、`/context`、`/settings`、`/btw`、`/rename`）由后续工单逐个接入。见 [spec](../spec.md) 的“TUI：命令与补全”。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 命令名匹配规则：`/` 后接 `[a-z0-9-]+`，再跟空白或结尾；匹配到内置命令才由 frontend 执行
- [ ] 不认识的 `/foo bar` 与以路径开头的输入（如 `/Users/x/a.ts 有 bug`）原样作为 prompt 发出；`/skill-name 参数` 照旧展开 skill
- [ ] 补全菜单：单行且以 `/` 开头、有匹配项时显示；名字前缀匹配、不区分大小写；每行带说明；skill 行带 `[skill]`；同名时内置优先
- [ ] 菜单按键：Up/Down 循环（菜单打开时优先于输入历史）、Tab 填为 `/name `、Enter 执行、Esc 关闭；多行输入不弹出
- [ ] run 中：`/skill` 随 steer 发出；`/exit`、`/help` 可执行（`/exit` 先中止 run）；表中标记为 run 中可用的命令可执行；其余命令显示“run 结束后再用”的通知
- [ ] `/help` 以本地静态输出列出内置命令与 skill
- [ ] `/clear` dispose 当前 session、用相同 options 新建，清空对话区；旧 session 仍可 `--resume`
- [ ] `/plan` 切换 plan mode（不走 `enter_plan_mode` 审批）
- [ ] `/rewind` 打开现有回退面板，行为与双击 Esc 一致
- [ ] `/goal` 提示“尚未支持”
- [ ] 命令名、说明、通知文案进 i18n（中英）
- [ ] TUI 测试（`start()` + 假终端）覆盖以上行为
