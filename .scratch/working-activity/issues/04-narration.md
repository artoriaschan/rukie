# 04: 自述 `⏵` 注入与剥离

Status: resolved

**What to build:** `createChat` 通过 `reminderSources` 注入 `narrate-instruction`（zh 原文，见 spec ④ 节），基础 System Prompt 不改。`AssistantMessage` 渲染前剥掉行首 `⏵` 行，流式和 resume 回放都剥。状态行显示自述，提取逻辑由 02 提供。

**Blocked by:** 03

- [x] 首次 Run 注入的 reminder 含指令，同一 Session 后续 Run 不重复注入
- [x] headless CLI 不注入
- [x] 流式和回放的消息正文都不出现 `⏵` 行，状态行显示它
- [x] `bun run check` 全绿

## Comments

- 2026-10-02：`createChat` 合并调用方的 reminderSources 并追加 narration source，中文指令与 dsh-working-activity 0.5.1 的 `narrate-instruction` zh 原文完全一致，保留 BSD-3-Clause 许可。首次 TUI Run 注入，后续 Run 和再次 resume 按持久化内容去重；基础 System Prompt 与 Headless CLI 保持原行为。
- `AssistantMessage` 在渲染边界剥离行首 `⏵`，包括流式中尚未换行的自述；纯自述不输出空回复标记。流式、完成后的 scrollback 和 resume 回放共用该组件，Transcript 与后续模型上下文仍保留原文。状态行继续使用 02 的提取逻辑。
- 验证：组件测试覆盖多行剥离、正文内联标记保留、未结束自述和 CRLF；e2e 覆盖首次注入、Run 去重、调用方 reminders、状态行与正文分离、原文保留及再次 resume 去重。同步两个既有 resume 测试以断言首次 TUI Run 的新增 reminder。既有 Headless CLI e2e 的精确模型消息断言继续通过。
- `rtk proxy env -u NO_COLOR bun run check` 退出 0：格式、lint、类型检查、knip 全绿，271 tests passed，0 failed。
- 双轴 code-review（以任务开始的 `53d0fd2` 为基准审查暂存区）：Standards 0 项发现，Spec 0 项发现。
