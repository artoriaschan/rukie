# 04: 自述 `⏵` 注入与剥离

Status: ready-for-agent

**What to build:** `createChat` 通过 `reminderSources` 注入 `narrate-instruction`（zh 原文，见 spec ④ 节），基础 System Prompt 不改。`AssistantMessage` 渲染前剥掉行首 `⏵` 行，流式和 resume 回放都剥。状态行显示自述，提取逻辑由 02 提供。

**Blocked by:** 03

- [ ] 首次 Run 注入的 reminder 含指令，同一 Session 后续 Run 不重复注入
- [ ] headless CLI 不注入
- [ ] 流式和回放的消息正文都不出现 `⏵` 行，状态行显示它
- [ ] `bun run check` 全绿
