# 03：时间提醒

Status: claimed

Blocked by: 01

**What to build:** 按 [spec](../spec.md#时间提醒工单-03)，`date` 改名 `time`，给出完整时间并在空闲 2 小时或跨日时刷新。

- [x] 格式、开场与 Compaction 后完整快照
- [x] 空闲刷新与跨日刷新，同日不刷新
- [x] 测试：注入时钟覆盖阈值前与阈值时、跨日、Compaction、Resume；固定 `TZ`
- [x] 文档：`docs/architecture.md` 提醒来源

## Comments

- Fresh implementer 03 claimed; public createSession injected now/model context/Transcript seams follow spec. TDD and rukie-doc applied. CodeGraph has no usable index; direct source reads.

- Implemented `time` snapshot format, local cross-day silence instruction, >= 7200 seconds idle refresh, historical Resume comparison and Compaction reinjection. Session `now` now supplies native user/toolResult timestamps and root/child committed assistant timestamps.
- Verification: injected-clock opening, threshold before/at, recent assistant/tool activity, cross-day and Resume public tests; negative half-hour UTC offset plus Compaction. `env -u NO_COLOR bun test` on five affected Agent files: 52 passed, 0 failed, 3.55s; focused Headless Resume: 9 passed, 4.08s. Affected stream-json passed; piped prompt passed after repairing stale environment assertion (`cwd` to Git snapshot).
- Initial snapshot test red (missing `time` source), then green. Threshold guard sensitivity run failed on unconditional snapshot reinjection; guard restored and tests passed. Compaction fixture initially lacked eligible history and declined; replaced with existing real-history helper.
- Targeted oxfmt/oxlint and `bun run check:docs` passed (155 Markdown files). No modified case exceeded 1s. Aggregate owner is root; evidence `/tmp/rukie-reminders-evidence/03.md`. Status remains claimed pending review and aggregate acceptance. ADR-0046 covers time contract; architecture owner updated, no new ADR needed.

- Review repair: public child Compaction now retains a recent idle-time reminder and recent task while publishing exactly one fresh full time snapshot after the native committed Compaction. Behavioral red then green; full time plus interrupted formatter9pass/0fail,513ms. TZ restoration remains guaranteed by finally when asynchronous cleanup rejects. Evidence: `/tmp/rukie-reminders-evidence/review-fixes.md`. Status remains claimed pending root aggregate and review.
