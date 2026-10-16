# 05：「+」插入列表与 `/goal`、`/plan` 内置命令

Status: claimed
Blocked by: 03

**What to build:** 按 [spec](../spec.md) 的「插入列表」一节，让「+」与 `/` 共用同一个插入列表，并加入内置命令组。用户点击「+」能看到附件、内置命令和全部技能；目标模式与计划模式改由 `/goal`、`/plan` 承担。

- [x] `/` 列表新增「内置命令」组，排在「技能」之前；首批 `/goal`、`/plan`，描述、开关或开/关状态、可用性与原「+」菜单一致，不可用时为不可用选项并显示原因
- [x] 「+」打开同一插入列表，三组「添加（附件）/ 内置命令 / 技能」，全部列出，无搜索；替换原下拉菜单
- [x] 从「+」选中技能时插到开头并保留正文；选中 `/goal`、`/plan` 执行动作且不改输入
- [x] 「+」列表打开时，在开头输入 `/` 切换为 `/` 列表，其他输入关闭「+」列表并照常输入
- [x] Run 进行中列表照常可用，`/goal`、`/plan` 的可用性跟随原规则
- [x] 内置命令行同样遵守单行布局与右侧内容固定的规则
- [x] 按布局保护流程更新「+」区域基线，输入框几何不变；浏览器测试覆盖两种入口的分组、切换、执行与无障碍语义
- [x] zh 与 en 文案同步更新

## Comments

## Implementation and verification evidence

Owner: fresh implementer `implement_05`, isolated `/tmp/rukie-composer-05`, branch `feat/composer-ticket-05`, based on integration `54b2c693`. Status remains claimed pending integrated review and final acceptance. Applied TDD, beUI and rukie-doc workflows; approved public seams are the spec Testing Decisions. CodeGraph has no index in this isolated checkout and was skipped after its explicit unavailable result.

The installed beUI Popover and ScrollArea remain the single insertion shell. A small action presentation contract lets Composer supply existing attachment/Goal/Plan behavior to the same grouped listbox; no new primitive or dependency. It keeps Lexical focus/active descendant, button and disabled-row cursors, typed slash switching, cached refresh, Run usability and existing command guards. The plus entry is the authorized layout change; its out-of-flow panel now follows the existing DESIGN.md insertion roles, while input/dock geometry remains covered by exact baseline assertions. Removed obsolete original dropdown-only CSS. No MCP command is added before ticket 08.

Initial TDD tracer: `rtk proxy bunx --no vitest run --project ui-browser tests/components/builtin-insertion.browser.test.tsx` in `packages/ui` failed because the old plus menu claimed focus and hid the combobox (14.99s assertion timeout). The same tracer passed with shared three-group panel, exact 752px width, unchanged form bounds, body preservation and token replacement (976ms total). Initial command startup before writing the test found no files; no behavior evidence claimed from that attempt.

Expanded cases initially had 3 pass/1 failure (16.21s total): the typing test assumed an unselected editor's caret started at the end; actual native focus put it at the beginning. The fixture now explicitly selects End before opening plus, retaining the requirement that input respects current caret position. No production change was made for that test assumption.

Area `rtk proxy bunx --no tsc -b packages/ui` reported only the six known integration-baseline MCP test errors in `packages/agent/tests/mcp/manager.test.ts` (removed createMcpManager and dependent implicit-any callbacks); ticket 06 owns the relocation. Focused oxlint over changed production and browser test files passed. Aggregate acceptance and the one final Light/Dark/narrow manual Chromium verification remain parent-owned; no native Electron or real settings/credentials were used.

The six-file focused Chromium command (`tests/components/builtin-insertion.browser.test.tsx tests/components/composer.browser.test.tsx tests/components/skill-insertion.browser.test.tsx tests/app/goal-mode.browser.test.tsx tests/app/plan-mode.browser.test.tsx tests/app/layout.browser.test.tsx`) completed with 48 passed/3 failed in 47.97s. All three failures were old component plus assertions: a remaining textbox locator, old menu/radius/width/focus expectations and fixtures at viewport top with no space for the required above-composer panel. Updated only the authorized plus region and positioned those two test fixtures with space above; retained exact editor/toolbar bounds. Minimum rerun of the three changed component cases plus four builtin cases and slash sorting passed 8 cases/15 skipped in 1.81s. Existing app Goal/Plan (including zh/en, disabled reasons, confirmation cancellation, reduced-motion focus), slash and full shell geometry evidence from the five passing files remains valid.

A further entry-refresh/cache case passes (993ms): opening plus after a filtered slash clears the filter, shows the alphabetical cached catalog and refreshes once for each entry/opening. A public separator-deletion reproducer then failed in 14.96s: the serialized selected token was mistaken for typed slash text, so Enter reselected instead of sending. The picker now excludes an existing leading SkillTokenNode from slash triggering. This fix affects editor token/clipboard composition, so after integrating ticket 04's actual forwarding and token/clipboard modules the minimum combined run (`tests/components/builtin-insertion.browser.test.tsx tests/components/skill-insertion.browser.test.tsx tests/components/skill-clipboard.browser.test.tsx`) passed 16 cases in 2.21s. New cases run below one second individually; earlier 15-second failures were assertion bounds.

Integrated `c1b2672f` before delivery, removed the temporary local PromptEditor forwarding shim and kept ticket 04's committed owner unchanged. Resolved only the duplicate picker type/import ordering and README paragraph by retaining both contracts. Area `rtk proxy bunx --no tsc -b packages/ui` now exits 0 with ticket 06's integration fixes. `rtk proxy bun run docs:update` and `rtk proxy bun run check:docs` passed (157 Markdown files); changed-file oxlint, oxfmt and diff checks pass. The shared panel/list accessible name is now localized Insert/插入 while group headings retain their individual names. Final aggregate and manual-browser evidence remain parent-coordinated.

The final localized shared-panel name adjustment invalidated only two name-based assertions. Focused `-t "plus shares|filters names"` across builtin and skill insertion files passed 2 cases/11 skipped in 1.03s. Existing geometry and behavior evidence is retained.
