# 07: 面板小终端降级与鼠标

Status: claimed

Blocked by: 05, 06

**What to build:** 小终端下按以下顺序逐级降低显示内容：

1. 去掉分区空行和档位说明；
2. 提示行缩短为 `Enter · Esc`；
3. 隐藏能力摘要；
4. 高度不足 3 行时隐藏档位条。

tab 条和档位条放不下时，围绕焦点只显示一部分，两端用 `‹ ›` 提示还有内容。鼠标可以点击 tab、模型行和档位格，滚轮移动模型焦点。要保持 ADR-0006 的阅读位置和 bottom-follow 行为。见 spec 用户故事 16。

- [x] 终端断言：80×24、60×16、40×12 下面板的布局，以及 resize 后的重排
- [x] 终端断言：点击 tab、模型行和档位格时，对应的状态变化正确；关闭面板后正文阅读位置不变

## Implementation and verification

- Fresh implementer worktree `feat/model-switching-07` starts from integration commit `38de54c8`; ancestry verified before edits.
- Uses the existing ModelPicker, ListItem and native mouse events. No renderer API or lifecycle changes. Full panel accounts for two spacing rows and the thinking explanation; provider/thinking strips reserve continuation markers and keep their focus visible. The compact composer makes the panel fit 40×12.
- Captures the original chat source anchor before queued picker opening; `/model` no longer resets manual reading to bottom. Closing restores the captured anchor or explicit bottom-follow intent, including after resize.
- TDD red: pre-change picker truncates the long shortcut hint at 60×16 rather than showing `Enter · Esc`. The public app test also reproduced reading drift after close/resize before the capture/restore fix.
- `env -u NO_COLOR bun test packages/coding-agent/tests/tui/screens/chat/model-picker-layout.test.ts packages/coding-agent/tests/tui/components/model-picker/model-picker.test.tsx`: four passing tests cover 80×24 / 60×16 / 40×12, resize, focused continuation windows, native SGR tab/thinking/model clicks and wheel, historical reading and bottom-follow. Component terminal assertions cover full layout at height 14, spacing/explanation removal at 13, short hint with capabilities retained at narrow width, capabilities hidden at 8, strip retained at 3 and hidden at 2. All individual cases below one second.
- Related focused verification (model-switch, model-thinking, model-picker-filter, model-picker-layout, component model-picker, image-model-notice, image-preview): 41 pass, 0 fail in 8.68s; no individual case over one second.
- `bun run check:dev`: passed formatting, lint, TypeScript, Knip, scratch/docs, ink boundaries and test-policy. README and both locale dictionaries updated. Full aggregate acceptance remains with the integration owner; status remains claimed until ticket and spec close together after review and ADR coverage. A premature resolved status correctly fails check:scratch because the spec is still open.
- Separate existing affected fixture: `packages/coding-agent/tests/tui/e2e/fullscreen.test.ts`, `startup header receives the configured thinking level and shows cwd on its own row without tips`, fails both related run and isolated run because the non-reasoning faux model now clamps requested high to off. Integration owner is handling this model-selection fixture before final acceptance; it does not involve picker layout or mouse behavior.
- ADR coverage: retains ADR-0006 source reading/bottom-follow and terminal primitives, and ADR-0008 frontend-only localized copy. No new durable architectural decision.

### Code review fixes

- Reproduced the review finding through rendered terminal rows: a 7-row allocation painted 8 rows, and 40×12 with persistent Todo and a live Subagent displaced the status row. ModelPicker now counts its border and fixed chrome before allocating model rows and the thinking strip. Below 7 rows it uses a borderless focused list with keyboard hints; below 3 rows the thinking strip yields. Missing-credential feedback uses the retained hint row. Renderer APIs, source anchors and follow ownership remain unchanged.
- The component asserts actual painted row counts at allocations 7, 3 and 2. The public app regression opens the picker at 40×12 with both persistent panels, verifies their previews and status remain visible, and confirms keyboard model selection. Existing resize, mouse, historical reading and bottom-follow cases remain green.
- Updated only the four affected TUI fixtures (startup header, English effort, CLI forwarding, Subagent card) to explicitly supply a reasoning-capable faux model. All four reproduced failure with the old non-reasoning metadata, then pass in 1.30s; each case below one second. Headless override already uses a reasoning-capable configured model and passes unchanged (0.71s case / 0.92s process).
- Focused picker/layout: 5 pass in 1.95s, all cases below one second. Expanded affected files: 117 pass / 1 fail in 21.48s; the new component assertion read the previous frame because its unchanged model-text predicate completed too early. Changed the predicate to wait for the expected strip disappearance before checking height. Model-related five files after correction: 14 pass, 0 fail in 2.88s, all cases below one second. The unchanged Esc interruption integration took 2.46s in the expanded run; no timeout or sleep was added.
- `bun run check:dev` passed. Owning TUI README explains counted chrome and the tiny-budget fallback; the fallback is a reversible local presentation choice within ADR-0006, with frontend-local copy per ADR-0008, requiring no new ADR. Ticket remains claimed and spec remains open until integration review and final acceptance.
