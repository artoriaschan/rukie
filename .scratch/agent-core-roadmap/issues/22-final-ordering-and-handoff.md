# 22: 最终排序与 handoff

Type: grilling
Status: resolved
Blocked by:

## Question

01–21 号能力工单已全部定完。汇总它们之间的依赖图，结合 main 上已落地的实现，给出剩余能力的实现顺序与 handoff 清单。

需定：

- 已落地、部分落地、未开始，各有哪些能力。依据 main 的 git 历史、`.scratch/<feature>/` 下的 spec 与票据状态。
- 剩余能力之间的硬依赖（地基 A/B/C 的消费者、Tool State、交互回调），以及哪些可以并行。
- 排序。按 Notes 的原则：先地基，再按学习价值，sandbox 最后（已划出范围）。
- 每项走出地图后的入口：已有 spec 的直接实施，没有 spec 的先走 `/grill-with-docs` → `/to-spec`。
- 地图收尾：确认 Destination 已达成，关闭地图。

## Answer

Destination 已达成，地图关闭。

- 落地情况：01–21 号能力全部已有 spec，并实施合入 main。各 `.scratch/<feature>/` 的 spec 均为 resolved / done，工单全部关闭；Tool View 见 `39fa567`，composer image peek 见 `ee9940b`。没有剩余的能力需要排序，所以不再出实施顺序。
- 遗留验收（不阻塞关图）：[TUI /mcp 报告与子命令](../../mcp-oauth/issues/08-tui-mcp-command.md) 代码已完成，只差人工在浏览器完成真实托管账户（Notion）授权后重跑验收，状态保持 ready-for-human。2026-10-07 用户确认验收通过，已 resolved。
- 状态行增强票留在 working-activity spec 内 triage，不回地图：[中途切换模型](../../working-activity/issues/07-model-switch.md) 与 [子代理事件](../../working-activity/issues/08-subagent-events.md) 改为 ready-for-agent，所需 Agent Core 能力已有（`setModel` 发 `tool_state_changed`，子代理进度走 `subagent_event`）；[retry 事件](../../working-activity/issues/05-retry-events.md) 保持 needs-triage，先确认 pi 是否暴露重试信号。
- Out of scope 各项（sandbox、web search、SSE MCP 等）不续用本地图。将来要做时另开新的 wayfinder effort；sandbox 第一张票为 research。
