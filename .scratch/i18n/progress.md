# i18n issues execution

Goal: finish issues in numeric order using a fresh /implement subagent per issue.
Branch: codex/i18n-issues-02-05
Starting commit: 9e8f182

- 01: already done at 9e8f182; checked ticket, plan, history and clean working tree.
- 02: done; implementation `8634538`, reviewed fix `00663db`; interface copy and startup notices.
- 03: done; implementation `62d6dec`, reviewed layout fix `39e0f02`; activity phrases and narration.
- 04: pending; locale-agnostic Agent Core errors.
- 05: pending; hardcoded Chinese scan.

Each worker reads /Users/artorias_chan/.agents/skills/implement/SKILL.md,
uses public-behavior TDD where appropriate, runs the full check, performs
the two-axis /code-review, updates its issue and commits on this branch.
Controller verifies history, issue state and evidence before dispatching
the next issue. After 05: final full validation and local main integration.

## Issue 02 evidence

Completed on 2026-10-03: `8634538` + `00663db` (current branch; no merge/push).
Scope: TUI app dictionary and props-supplied locale for interface chrome,
approval, status details, welcome effort, startup diagnostics and inline notices.
Activity/narration, Agent Core coded errors, and hardcoded-Han scan remain with 03/04/05.

Verification: argv, approval, status, badge, startup and notice slices red then green;
`rtk proxy bunx tsc -b` passed regularly; focused locale/fullscreen after repair
40 pass / 150 assertions; final `rtk proxy env -u NO_COLOR bun run check`
passed formatting, lint, typecheck, Knip and 549 tests / 3066 assertions (50 files).
Local check output: `/tmp/neant-i18n-issue02-check.log`.

Review fixed point: `9e8f182`; diff command `git diff 9e8f182...HEAD`.
Standards: 0 findings. Spec: 1 P2 (non-interactive guidance ignored user locale).
Fixed in `00663db`, with public main red/green regression; original Spec reviewer
rechecked and confirmed no remaining or new findings. No unresolved issues.

## Issue 03 evidence

Completed on 2026-10-03: implementation `62d6dec` + Standards repair `39e0f02`
(current branch; no merge/push).
Scope: 18 adjacent `EN_` pool mirrors, fixed startup locale for activity,
upstream structural dictionary keys/tool plural forms/shared duration formatter,
and locale-specific narration instructions. Chinese behavior remains covered.
Independent upstream comparison: 16 corresponding English pools and 22 original
action pools identical; zh/en narration both identical to upstream `lang.ts`.
Five Neant-specific alias groups and REVIEW text authored locally.

Verification: public main/start English activity and narration env/settings
slices red then green; old ambient-locale main/resume regression pinned zh,
red then green. Mirror tests cover all 18 pools (nested actions/tiers/holidays
included), shared holiday/春节 boundaries; English activity covers summary
plurals, durations, aliases, streaks, compaction, approval/review, failure and
interruption. Regular `rtk proxy bunx tsc -b` passed; focused 68 pass / 1334
assertions. Final `rtk proxy env -u NO_COLOR bun run check` passed formatting,
lint, typecheck, Knip and 584 tests / 3965 assertions (51 files).
Latest full log: `/tmp/neant-i18n-issue03-check.log`.
Upstream comparison log: `/tmp/neant-i18n-issue03-upstream.log`.

Review fixed point `07005ba`, diff `git diff 07005ba...HEAD`.
Standards: 1 P3 test directory layout finding fixed in `39e0f02`; original
reviewer confirmed 0 remaining and 0 new findings. Spec: 0 findings.
No unresolved issues. 04/05 remain pending.
