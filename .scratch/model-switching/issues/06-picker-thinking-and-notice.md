# 06: 档位条、合并提示与状态栏

Status: resolved

Blocked by: 01, 04

**What to build:** 面板底部加档位条，内容为焦点模型的 `thinkingLevels`。←/→ 只调整草稿，按 Enter 时用 `setModelSelection` 让模型和档位一起生效，按 Esc 放弃。只改档位也算一次切换。根据返回值生成合并提示（名称和 spec、档位、降档说明）。状态栏的档位改为来自 `session.thinkingLevel`。Run 进行中输入 `/model` 时给出提示。见 spec 用户故事 7–13。

- [x] 终端断言：←/→ 调整档位后按 Enter，状态栏显示新档位，提示合并为一条
- [x] 终端断言：`reasoning: false` 的模型档位条显示为不可用；切到不支持当前档位的模型时，提示里说明降档
- [x] 终端断言：Esc 放弃草稿；`/model <spec>` 只切模型
- [x] 终端断言：Run 进行中输入 `/model` 时出现提示，面板不打开

## Claim

Owner: fresh implementer issue_06; worktree `/tmp/rukie-model-switching-06`, branch `feat/model-switching-06`. Confirmed integration `feat/model-switching` is an ancestor of initial HEAD `f16c72ed`. Tests use the spec-authorized app/headless terminal and view projection seams.

## Implementation and verification

- Picker owns a synchronous Thinking Level draft, seeded from `session.thinkingLevel`. Left/right and clickable cells edit only that draft; Enter passes model and requested level together to `setModelSelection`. Changing focus retains the requested draft so Core reports `clampedFrom`. Escape discards it; filtered selection uses the filtered focused model's levels.
- View owns the merged localized notice from before/returned effective selection, model name/spec and downgrade facts. It omits unchanged facts and wraps the single notice to the supplied terminal cell width, preserving downgrade text on narrow terminals.
- Status, logo and thinking effort presentation now read the Session value; status hides off. Existing Run-time `/model` rejection stays immediate. Direct `/model <spec>` omits thinking input and lets Core retain/clamp it.
- TUI README updated; ADR-0008 localization/frontend ownership and ADR-0006 terminal behavior remain unchanged. Spec ADR Coverage reviewed for this ticket; no new architectural decision.
- TDD: the initial terminal test failed because no thinking strip existed; the view test failed because downgrade facts were truncated/long text was not split. Green terminal coverage verifies rapid right/right+Enter, low→high request propagation, Escape, unsupported plain model, preserved high→off clamp through filtering, model-only switching, Run rejection and no deferred picker, Rewind high restoration, and resume high instead of settings low.
- After merging integration `6d3b00d4` (including 05), focused model thinking/switch, view, status-line and image notice set passed: 65 tests, 321 assertions, 6.29s. Filtering public test separately passed: 1 test, 12 assertions, 1.15s. New/modified thinking cases were all below 1s in final focused execution; initial isolated startup reached 1.75s due to fixture/terminal setup, without real sleeps or expanded timeouts.
- Earlier isolated terminal startup failed once at the shared parser's one-second deadline; subsequent focused run passed without changing its bound. Image tests initially failed old model-only notice strings and were updated to the new name/spec contract. `check:dev` initially failed this ticket's unsupported `in-progress` status; corrected to tracker `resolved` after focused verification.
- After final merge resolution, `bun run check:dev` passed (7.22s): docs:update, formatting, Oxlint, TypeScript, Knip, tracker, documentation links, ink boundaries and test policy. `git diff --check` passed. Full aggregate `check` is reserved for the integration owner after all tickets land.
