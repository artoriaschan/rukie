# 06: System Prompt 与 System Reminder

**What to build:** 让模型在每个 Session 里都拿到稳定的身份信息和环境上下文。

- **System Prompt**：一份静态文本，内容是 coding agent 的身份、工具使用规范和风格，构建时内联进代码。所有项目都用同一份，里面不放任何环境信息或项目信息。
- **System Reminder**：定义一种自定义消息类型，在 `convertToLlm` 时转成包着 `<system-reminder>` 的 user 内容。
  - Session 第一条 user 消息上注入：环境信息（cwd、平台、日期、git 分支和 status），以及 Project Instructions（用户级的 `~/.neant/AGENTS.md`；项目级的 `AGENTS.md`，没有时用 `CLAUDE.md`）。
  - resume 时如果日期变了，补发一条增量 reminder。
  - 所有 reminder 都写进 Transcript，以后不再修改。
  - text 输出里看不到 reminder 内容；stream-json 里会发出 `reminder_injected` 事件。
- 这张 ticket 要把"按来源比较、只补发变化的部分"做成通用机制，07 和 08 会在此基础上添加 skills 和 MCP 两种来源。

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] System Prompt 在所有项目和所有 Session 中逐字节相同
- [ ] 首次 Run 时，环境信息和 Project Instructions 都附在第一条 user 消息上；`AGENTS.md` 优先，没有时用 `CLAUDE.md`；两个文件都不存在时不注入这部分
- [ ] resume 后，之前注入过的 reminder 原样保留；日期变化时只补发日期这一条
- [ ] 增量机制可以扩展：新的 reminder 来源只需提供"当前内容"，就能参与比较
- [ ] Seam 1 测试覆盖：首次注入的内容；resume 后上下文前缀不变；日期变化时补发（时间可以在测试中注入）；`reminder_injected` 事件
