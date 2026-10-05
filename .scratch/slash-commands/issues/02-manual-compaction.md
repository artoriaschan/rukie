# 02: 手动 compaction

**What to build:** 用户在 TUI 输入 `/compact` 或 `/compact <侧重点>`，立刻压缩上下文、不看 80% 阈值；侧重点只影响这一次摘要。进度与结果通知与自动 compaction 一致，hooks 能区分手动触发。见 [spec](../spec.md) 的“手动 compaction”。

**Blocked by:** 01（命令框架与补全菜单）

**Status:** resolved

- [x] Session 新增 `compact({ instructions? })`：仅空闲，run 中抛错；没有可压缩内容时抛错；与自动 compaction 共用压缩路径
- [x] `instructions` 透传给 pi compaction 的 `customInstructions`，出现在摘要请求里，不进 transcript
- [x] `compaction_start` / `compaction_end` 增加 `trigger: "auto" | "manual"`（shared 事件 breaking change）
- [x] PreCompact / PostCompact hook 输入 `trigger` 取 `manual` / `auto`；手动时带 `custom_instructions`（无指令为空串）；PreCompact 阻断时 `compact()` 抛出带 hook 原因的错误
- [x] 压缩后 SessionStart(`compact`) hook 与 reminder 重注入沿用自动路径；resume 后上下文与压缩结果一致
- [x] TUI `/compact [指令]` 接入；run 中被拒；错误以通知显示
- [x] Agent Core e2e（参照 `compaction.test.ts`、`compaction-hooks.test.ts`）与 TUI 测试覆盖以上行为

## Answer

Implemented idle `Session.compact({ instructions? })` through the same compaction lifecycle as automatic requests: native summary persistence, reminders, `compaction_start` / `compaction_end`, PreCompact / PostCompact, and next-user SessionStart context. Manual requests summarize completed history even below the automatic threshold, pass focus only to the summary request, reject missing history and hook denial with reasons, and restore identically on resume. No-history errors are localized by the TUI.

Manual compaction owns its idle operation until storage closes: competing runs, model changes, rewinds, plan writes, and second compactions reject; interrupt cancels summary generation, and dispose awaits closure. The TUI command uses the existing progress and result presentation and refuses commands while busy.

Validation: after merging ticket 05, affected Core compaction/hooks/model, TUI slash/activity/model and i18n suites: 116 passed, 0 failed, 931 assertions. This includes mutual busy rejection and summary requests using the newly selected model. CLI stream-json compaction expectation: 1 passed, 6 assertions. Formatting, lint, TypeScript and knip passed. Initial full `bun run check`: 1581 passed / 2 failed, both repaired and verified above (CLI's new trigger field and new no-history locale mapping). The final integration branch runs the full check again at its final HEAD.
