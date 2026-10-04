# 09: PreCompact、PostCompact 与 SessionStart(compact)

**What to build:** hook 可以阻止一次自动 compaction；compaction 后可以记录摘要，并重新注入被摘要掉的关键上下文。见 [spec](../spec.md)「接入：compaction 与交互」。

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] PreCompact 在自动 compaction 前触发，`trigger: "auto"`、`custom_instructions: null`，matcher 匹配 `trigger`。
- [ ] `decision: "block"` 或 exit 2：跳过本次 compaction 并 `hook_warning`；下次达到阈值仍会尝试。
- [ ] `compaction_end` 后触发 PostCompact，输入带 `compact_summary`，无决定。
- [ ] 随后以 `source: "compact"` 触发 SessionStart，上下文附在下一条 user 消息上。
- [ ] Agent Core e2e 照现有 compaction 测试（调小 `contextWindow`）覆盖以上。
