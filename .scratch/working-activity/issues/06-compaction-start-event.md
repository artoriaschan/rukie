# 06: 状态行：compaction 开始事件

Status: ready-for-agent

**What to build:** compaction 的摘要调用可能要几十秒，期间状态行没有任何变化。改为在摘要调用开始时发事件，让状态行显示"压缩中"，结束后用插话报告压缩前后的 token 数。现在没有外部脚本消费 stream-json，事件可以做破坏性改名。

**Agent Core**

- 现有 `compaction` 事件改名为 `compaction_end { summary, tokensBefore, tokensAfter }`；新增 `compaction_start { tokensBefore }`。两者都放在 `@neant/shared` 的 `CustomSessionEvent`。
- `tokensAfter`：用和 `tokensBefore` 同一套估算方法，估算 `restoreContext` 之后的 messages。
- `compactTurn` 新增 `onStart(tokensBefore)` 回调，在确定要调摘要模型、发请求之前调用。超过阈值但没东西可压、pi 准备失败等提前返回的情况不调用。
- 摘要调用失败或被中断时不额外发事件，靠 `result` 兜底（它一定会发）。

**TUI**

- `compaction_start` 设置 waiting-reason `compaction`，优先级高于文案池、低于审批。阶段不变，帧、扫光和耗时照常显示。
- 文案：从 dsh-working-activity 拷贝 `COMPACTION_START_PHRASES`（`收拾一下上下文…`、`整理背包中…`）到 `phrases.ts`，按种子 `runStartedAt + compactionStartedAt` 确定性地选取，同 approval。
- 收到 `compaction_end`、`message_start`、`result` 或 `interrupt` 任一事件时清掉这个 waiting-reason。
- 收到 `compaction_end` 后显示 6s 插话：`<COMPACT_PHRASES> · 120k→18k`，数字用 `fmtTokens` 格式化。
- `conversation.ts` 的 notice 改用新事件名。

**文档**

- CONTEXT.md 补 **Compaction** 词条（已完成）。
- `.scratch/headless-agent/spec.md` 列出的自定义事件名同步改掉。

**Blocked by:** 03

- [ ] Agent Core 测试：压缩时事件顺序为 `compaction_start` → `compaction_end`，两者 `tokensBefore` 相同，且 `tokensAfter < tokensBefore`
- [ ] Agent Core 测试：超过阈值但没东西可压时，两个事件都不发
- [ ] Agent Core 测试：摘要调用失败或被中断时只有 `compaction_start`，没有 `compaction_end`，Run 照常发出 `result`
- [ ] TUI 状态机测试：start 后显示压缩文案；优先级高于文案池、低于审批；四种清除条件各一条；end 后的插话带 `before→after`，6s 后消失
- [ ] CLI 和其他现有断言改用新事件名，仓库里不再出现 `type: "compaction"` 事件
- [ ] `bun run check` 全绿
