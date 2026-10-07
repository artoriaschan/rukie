# 09: PreCompact、PostCompact 与 SessionStart(compact)

**What to build:** hook 可以阻止一次自动 compaction；compaction 后可以记录摘要，并重新注入被摘要掉的关键上下文。见 [spec](../spec.md)「接入：compaction 与交互」。

Blocked by: 04

Status: resolved

- [x] PreCompact 在自动 compaction 前触发，`trigger: "auto"`、`custom_instructions: null`，matcher 匹配 `trigger`。
- [x] `decision: "block"` 或 exit 2：跳过本次 compaction 并 `hook_warning`；下次达到阈值仍会尝试。
- [x] `compaction_end` 后触发 PostCompact，输入带 `compact_summary`，无决定。
- [x] 随后以 `source: "compact"` 触发 SessionStart，上下文附在下一条 user 消息上。
- [x] Agent Core e2e 照现有 compaction 测试（调小 `contextWindow`）覆盖以上。

## Delivery / verification (2026-10-05)

- 自动压缩仅在达到阈值并确认有可压缩 Transcript 内容时触发 PreCompact；matcher 匹配 `auto`，stdin 带 `trigger: "auto"` 与 `custom_instructions: null`。JSON block / exit 2 跳过当前压缩、发出 `hook_warning` 与 `onWarning`，下一次达到阈值仍会重试。
- 原生压缩条目写入后先发 `compaction_end`，再调用 PostCompact（带 `compact_summary` 与 `trigger`），随后调用 SessionStart（`source: "compact"` 与 `model`）。PostCompact block / exit 2 没有阻断作用；三个事件的通用 `continue:false` 优先结束 Run。
- compact SessionStart 上下文排队到下一条实际 user 消息，包含下个外部 Run、同一 Run 的 Stop 反馈及子代理结束通知；普通工具续 Turn 不提前消费。上下文以 session-start-hook reminder 原生追加到 Transcript，可 resume 恢复。
- pi prepareRequest 无结束动作，Session 用私有控制异常结束循环，并消费其合成失败消息；公开 e2e 验证 `hook_stopped`、没有后续模型请求、Session messages / Transcript / agent_end 都没有合成失败，后续 Run 可正常继续。真实外部取消仍优先传播。
- 公开 Agent Core e2e 使用真实 command 脚本和较小 `contextWindow`，覆盖阻断与重试、摘要 / 顺序 / matcher、上下文延迟与恢复、同 Run 下一 user、通用停止、坏 JSON / 超时 / exit failure 放行、无可压缩 Transcript 的边界。最终 focused 验证：55 pass / 0 fail，304 assertions，5 files。
- /code-review 固定基线 `6b9bda79499c7a46b2ffc9a9e91107cd475cb16b`，最终代码 HEAD `af1eae35e16684329de91e73356997e1d28ae0d7`。Standards 初审：1 个 P3（测试标题未使用 Transcript 领域术语）与 1 个非阻断判断项（重复事件条件），均已修正；独立 Standards 复核 0 findings。Spec 初审：1 个 P2（compact 上下文仅下次外部 Run 消费，同 Run 的下一 user 缺失），两个公开回归先 red 后 green 修复；独立 Spec fresh 复核 0 findings，并独立运行 compaction / prompt / Stop 相关测试：34 pass / 0 fail，174 assertions。
- Fresh 全量 `bun run check` 使用临时 HOME 并移除 `NO_COLOR`，exit 0；format / lint / typecheck / Knip 全通过，**1279 pass / 0 fail，6818 assertions，98 files**。日志：`/tmp/neant-hooks-09-delivery-check.log`。
