# i18n issues execution

Goal: finish issues in numeric order using a fresh /implement subagent per issue.
Branch: codex/i18n-issues-02-05
Starting commit: 9e8f182

- 01: already done at 9e8f182; checked ticket, plan, history and clean working tree.
- 02: done; implementation `8634538`, reviewed fix `00663db`; interface copy and startup notices.
- 03: done; implementation `62d6dec`, reviewed layout fix `39e0f02`; activity phrases and narration.
- 04: done; implementation `7a6e954`; locale-agnostic Agent Core errors and frontend translation.
- 05: done; implementation `4d76e2d`; hardcoded Han scan and minimal resume-test idle wait.

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

## Issue 04 evidence

Completed on 2026-10-03: implementation `7a6e954` (current branch; no merge/push).
Scope: five code-discriminated shared errors, English Core fallback messages and
permission refusal reasons, shared zh/en error copy tied to the code union,
frontend startup/runtime/live-tool/replay translation and original-message
fallback. Core has no i18n dependency or new locale parameters. Headless CLI
source stays unchanged; its affected English error assertions were updated.
The builtin-tool boundary retains coded details for TUI display/replay while
model/transcript content remains English. No-model copy retains configuration
examples; missing builtin env names retain usable localized guidance.

Verification: public config/session/tools/permissions and i18n/startup/live-tool
slices red then green; cross-locale resume keeps transcript English; public
main/start covers all five codes in zh/en, runtime coded errors, absent/unknown
codes, malformed params and non-Error fallback. Compile-negative cases prove
code-bound params and error-key/interpolation constraints. Regular tsc passed;
focused main/CLI/i18n regression 108 pass / 503 assertions. First full run found
three legacy localization assertions, fixed and rerun focused plus full. Final
`rtk proxy env -u NO_COLOR bun run check` passed formatting, lint, tsc, Knip and
614 tests / 4038 assertions (52 files). Latest full log:
`/tmp/neant-i18n-issue04-check.log`.
Core red/green logs use `/tmp/neant-i18n-issue04-{red,green}-{config,unknown,key,session,permissions,tools}.log`.
Frontend evidence: `/tmp/neant-i18n-issue04-green-startup.log`,
`/tmp/neant-i18n-issue04-green-live.log`,
`/tmp/neant-i18n-issue04-green-resume-fallback.log`,
`/tmp/neant-i18n-issue04-green-key-guidance.log` and
`/tmp/neant-i18n-issue04-green-regression.log`.

Review fixed point `e453078`, diff `git diff e453078...HEAD`.
Standards: 0 findings. Spec: 0 findings. Both independent read-only reviews
cover implementation `7a6e954`; no repairs required and no unresolved findings.
Review logs: `/tmp/neant-i18n-issue04-review-standards.md` and
`/tmp/neant-i18n-issue04-review-spec.md`. 05 remains pending.

## Issue 05 evidence

Completed on 2026-10-03: implementation `4d76e2d` (current branch; no merge/push).
Scope: recursive Han protection for `apps/neant-tui/src`, `packages/agent/src`
and the related `packages/tui/src` renderer source. Only exact TUI dictionary
and activity phrase-pool paths are exempt; sibling/new/same-name files cannot
bypass the scan. Hidden and non-TS source files are included. Existing source
has no Han outside those files, so comments deliberately fail too. Regex uses
JavaScript Unicode `Script=Han`, including supplementary Han code points.

Verification: scanner location and exact-exemption slices red then green;
five fixture/current-source cases cover CRLF, complete file/line diagnostics,
strict line/block comments, precise whitelist boundaries and actual repo.
Regular `rtk proxy bunx tsc -b` passed. Focused scanner+main regression:
41 pass / 163 assertions. Final `rtk proxy env -u NO_COLOR bun run check`
passed formatting, lint, tsc, Knip and 619 tests / 4043 assertions (53 files).
Final log: `/tmp/neant-i18n-issue05-check.log`.

First two full runs failed the same legacy resume test with a 5s timeout,
while isolated/whole-main/TUI scopes passed. A public SessionStore.close gate
proved that displayed reply text could precede Run completion, so Ctrl+D was
ignored while working. Same gate red then green with a public terminal idle
wait; final maintenance is that one added wait before Ctrl+D. Product behavior,
timeouts and fixed sleeps were not changed; diagnostic instrumentation removed.
Failure logs: `/tmp/neant-i18n-issue05-check-{first,second}.log`.
Deterministic diagnostic: `/tmp/neant-i18n-issue05-resume-gate-{red,green}.log`,
with source preserved at `/tmp/neant-i18n-issue05-resume-gate-source.ts`.
Scanner red/green logs: `/tmp/neant-i18n-issue05-{red,green}-{locations,allowlist}.log`.
Final focused: `/tmp/neant-i18n-issue05-green-regression.log`.

Review fixed point `bbadd8d`, diff `git diff bbadd8d...HEAD`.
Standards: 0 findings. Spec: 0 findings. Both independent read-only reviews
cover implementation `4d76e2d`, including renderer coverage and authorized
minimal test maintenance; no repairs required and no unresolved findings.
Review logs: `/tmp/neant-i18n-issue05-review-standards.md` and
`/tmp/neant-i18n-issue05-review-spec.md`. All five issues are now done;
controller final validation and local main integration remain.

## Controller final acceptance

All five issue files have `Status: done` and no unchecked acceptance items.
Issues 02–05 were executed in order by fresh /implement subagents, each with
public-behavior tests and independent Standards/Spec review. All review
findings were repaired and rechecked; no unresolved findings remain.

Local `main` fast-forwarded from `9e8f182` to `a483972`. Post-integration
`rtk proxy env -u NO_COLOR bun run check` exited 0: formatting, lint,
`tsc -b`, Knip and 619 tests / 4043 assertions (53 files, 91.99s).
Final log: `/tmp/neant-i18n-final-check.log`. `git diff --check` passed and
the integrated working tree was clean. No remote push was performed.
