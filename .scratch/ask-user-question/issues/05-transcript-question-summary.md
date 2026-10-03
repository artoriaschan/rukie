# 05: transcript 问答摘要

**What to build:** 提问结束后，transcript 中 `ask_user_question` 的工具卡片显示"提问"摘要及每题一行"问题 → 回答"；拒绝回答显示"未回答"。resume 会话后显示一致，数据只来自 transcript 中的工具参数与结果，不额外存储。

**Blocked by:** 02（单题单选端到端提问）

**Status:** ready-for-agent

参考：[spec](../spec.md) transcript 呈现。

- [ ] live 渲染：回答后工具卡片显示问答摘要
- [ ] 拒绝回答显示"未回答"；run 中止的提问按普通中止工具卡片显示
- [ ] resume 后同一会话渲染结果与 live 一致
- [ ] 文案走 i18n（zh/en）
- [ ] TUI seam 测试覆盖 live 与 resume
