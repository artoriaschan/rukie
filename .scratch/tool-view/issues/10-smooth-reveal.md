# 10: smooth reveal

**What to build:** 工具调用的 pending call view（如待写入的 diff）逐行平滑出现，而结果和回放内容立即完整显示。见 [spec](../spec.md) 的「渲染组件」。

Blocked by: 04

Status: resolved

- [x] 共享调度器约 30 fps，每 tick 推进 `max(3, ceil(backlog / 8))` 行
- [x] 只作用于 pending call view；result view、错误、已展开、resume / replay 卡片不启用
- [x] 测试用可注入时钟或显式 tick 推进，不靠时间猜测

## Implementation and verification

- Added a module-shared 30fps scheduler. Each active cursor advances `max(3, ceil(backlog / 8))` visible rows, clamps to the visible window and releases its timer on completion or unmount. Dedicated 33ms cadence avoids quantizing this contract into the renderer clock's 48ms subscription interval; renderer paints retain their existing 16ms clock.
- Reveal applies only to running call diff views with no result, error, expansion or replay. Unified and split rows use the same visible-count hook after folding. Result/error arrivals and global/per-card expansion snap immediately; caught-up or snapped call identities do not restart on collapse/resize.
- Completion identities belong to a Session provider, scoped separately for Subagent tool IDs and bounded across remounts. Two concurrent apps with identical model-generated call IDs therefore animate independently while sharing the scheduler phase. Unmount clears active subscriptions; no timer remains while idle.
- Public seam `startWithClock` + headless terminal covers the frame boundary before/after the first reveal tick, three-row advancement, immediate result/error, per-card/global expansion followed by collapse, two apps sharing cadence without identity collision, split paired rows, completed pending resize, and Session Resume. All waits synchronize on terminal predicates or explicit timer advancement.
- `env -u NO_COLOR bun test apps/neant-tui/tests/e2e/tool-reveal.test.ts apps/neant-tui/tests/e2e/split-diff.test.ts apps/neant-tui/tests/e2e/file-diff.test.ts apps/neant-tui/tests/e2e/tool-expansion.test.ts`: 20 passed, 74 assertions, 2.31s. New scenarios took 35–152ms; no new real waits or case over one second.
- `bun run check:dev` passed; renderer/application README agrees with behavior. The integration owner runs the final aggregate gate once.

- Synced integration through `f87223e` (08 tooltip/command folding and09 file actions), preserving settings, hover metadata, nested path clicks and split path callbacks. Post-sync `check:dev` passed; reveal + file actions: 13 passed, 47 assertions, 2.19s. Earlier post08 reveal + tooltip: 12 passed, 57 assertions, 1.64s. Ticket11 uses the visible count after selecting its active 400-line window; expanded search rows bypass reveal entirely.
