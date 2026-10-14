# 04：运行纠偏提醒

Status: resolved

Blocked by: 01

**What to build:** 按 [spec](../spec.md#运行纠偏工单-04)，新增重复调用、无进展、工具调用上限与输出截断续写提醒。

- [x] 重复调用 3/5/8、无进展 15/25/40 分级提醒，进展事件重置
- [x] 工具调用上限总结提醒
- [x] `length` 截断续写最多 3 次，无可见输出时的重试提醒
- [x] 测试：阈值前后、计数重置、续写上限、Compaction 与 Resume 后清零

## Comments

- Claimed by fresh implement_04 on feat/reminders-04, based on integration 88ab6b01. TDD seams are the spec-agreed public Session/fake model context and owner threshold reducer; root coordinates aggregate verification.

- Implemented per-Conversation ephemeral correction owner anchored to accepted Run first Submission and committed Compaction epoch, shared root/child wiring. Counts committed Tool Calls (including parallel batches), canonicalizes object-key order, and honors actual successful effects; completed plan reviews and admitted delegations use typed receipt details even if downstream work reports failure.
- Length retries preserve accepted Goal round, cap at three continuations, persist owner facts, and project automatic System Reminder role so Frontends cannot render them as human input. No visible text requests shorter reasoning. Existing tool-limit guard remains intact with summary guidance before next request.
- Red: public length cap case failed with immediate `Model response ended with stop reason length` before implementation (203ms); subsequent projection test exposed USER-role leakage and was fixed via explicit reminderContent facts rather than frontend text parsing.
- Focused: six files 69 passed, 0 failed, 297 assertions, 3.13s (`04-focused.log`). New incremental Session cases cover same-Run Compaction, Resume/Rewind, child wiring and parallel calls; all under 150ms each. Owner tests cover literal 3/5/8 and 15/25/40 thresholds, failure versus success, Todo completed-count increase, all progress types and reset of length/limit state. No timing waits or real credentials.
- Goal fixture changes are causal: unrelated idle/edit/disarm/cold-resume tests previously used length as an immediate terminal sentinel; length is now automatically continued, so these use aborted. Dedicated parametrized length test retains the outcome assertion and proves four requests within one Goal round plus explicit resumed round 2. Child length outcome test supplies exactly four truncations to retain exhausted-length persistence coverage.
- Local `bunx --no tsc -b packages/agent --pretty false`, targeted oxlint, oxfmt and diff check passed. Initial broad type attempt identified duplicate child hook and EntryId signature mistakes; repaired before passing owning package check. Aggregate/static/docs coordinated by root; no package/full-suite duplication. ADR-0046 covers this runtime reminder duty; no additional architectural decision.
- Remains claimed pending integration two-axis review and final verification; external evidence `/tmp/rukie-reminders-evidence/04.md`.

- Frontend acceptance repair: Headless Goal length fixture supplies four truncated responses to exercise the three-continuation cap, asserting exit1, exact closing text, four model requests and accumulated continuation reminders0/1/2/3. Error sentinel remains unchanged behavior with request1. Related6files117pass/0fail7.92s; additional clock consumers6pass/0fail807ms; strengthened2assertions2pass/0fail844ms. Original1539pass/5fail213.05s remains recorded, not relabelled. All modified cases under1s; targeted types/lint passed. Full commands/failures/evidence: `/tmp/rukie-reminders-evidence/frontend-fixes.md`. Status remains claimed pending root delivery.

### Final delivery verification (2026-10-15)

实现、受影响消费者、文档、评审修复及适用本地验证已完成。工单由独立新 implementer 在独立工作树实施，当前实现代码为 `3652bd51`；本工单的 focused 与增量证据见上方记录，原始失败事实保留。

统一验收结果、ADR Coverage 审阅和证据复用范围由 [spec 交付记录](../spec.md#delivery-and-adr-coverage-review-2026-10-15) 唯一维护。PR [#27](https://github.com/artoriaschan/rukie/pull/27) 在 `feat/system-prompt-reminders` 交付，最新 CI 待验收，尚未合并；`resolved` 不表示 CI 或合并完成。
