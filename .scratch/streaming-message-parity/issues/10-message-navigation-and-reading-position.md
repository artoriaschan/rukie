# 10: 消息导航与阅读位置

Status: resolved
Blocked by: 02, 03, 05, 06, 07

**What to build:** 用户能通过键盘和滚轮浏览完整会话、展开详情及定位会话边界，同时持续流式输出、卡片收束和面板切换不夺走阅读位置。

规范用户故事：42–48、53–54、56、58–60。

以 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 和父规范为准。保留 Neant 品牌、中英 Locale、Session 权限与生命周期；缺失信息不伪造，不新增老会话兼容。必要数据、消费者、公开行为测试和所属文档在本工单一起交付，使用现有 start/startWithClock 与必要的 createSession 入口。开发运行最小受影响检查，代码交付遵循仓库完整验证规则。

## Acceptance criteria

- [x] Ctrl+O 按参考控制全局详情，单条展开与全局状态协调；覆盖思考、工具和 Background Job 分组的实际行为。
- [x] Shift+↑ 进入消息选择，方向键移动、Enter 单条展开、Esc 退出；Background Job 与 Subagent 不作为普通可折叠消息参与该模式。
- [x] 实现参考会话边界导航与固定用户提示；将参考导航边界映射为真实 Neant Run/Turn 或用户输入锚点，不重定义领域术语。
- [x] 向上阅读暂停跟随并显示新内容提示，回底或主动提交按既有规则恢复跟随；不能靠固定行号替代稳定阅读位置。
- [x] 消息插入、平滑增长、卡片折叠、任务结束、窗口变化及 resize 都保持正确锚点，不跳到错误消息。
- [x] 与输入历史、选字、Interaction、jobs、Subagent 详情和其他现有面板共存时键盘、滚轮及焦点有明确所有者；普通选字不触发导航动作。
- [x] Session 切换和恢复清除选择、展开及滚动的临时状态，使用参考默认状态；小终端仍能中断和退出。
- [x] 通过 start/startWithClock 验证各模式、卡片类型、消息边界和共存面板；断言屏幕、阅读位置及实际动作，不检查私有 state 代替行为。

## Implementation evidence

- Fixed reference: dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4`, `TimelineRail.tsx`, `ink/timeline-rail.ts`, `Chat.tsx` and `PinnedTurnHeader.tsx`. The two-column rail uses real user-message anchors, strict reachable chevrons, centered input windows, 120ms dwell, first-nonempty-line/two-line previews, opaque inactive-colored rounded chrome and NoSelect fences. The pinned header appears only while reading and flattens the full real input; neither auxiliary feedback nor invented Run boundaries enters the rail.
- Shift+Up enters a stable message cursor. Ordinary messages, thinking, tool and plan entries retain their own identity across live/settled presentation; Background Job/Subagent use their existing entries. Enter only toggles the selected fold, arrows seek current measured geometry, Kitty/modifyOtherKeys Escape restores the draft. Interaction, existing modal/side panels, tool-window keyboard and active text selection retain ownership; Ctrl+O keeps the existing union of global and individual expansions.
- `ScrollSnapshot.anchors` and deferred `scrollToAnchor` expose measured stable-box geometry. Mounted layout changes preserve source/text offsets at unchanged width as well as resize; remounted text falls back to stable identity. Removing the visible detail returns to its nearest surviving card. These renderer APIs carry no Session domain policy. Box/ThemedBox border colors apply only to chrome.
- Public red cases: unchanged-width 20→3 preceding-card contraction jumped reader-5→reader-22; remounted Text reproduced the same gap; removing a nested body jumped body-4→tail-21. All now preserve the correct source/card. Public input red dropped Kitty CSI27u while modifyOtherKeys worked; decoding now checks the protocol final byte and both encodings reach frontend handlers. Preview border red showed terminal default instead of fixed-reference inactive RGB, now corrected.
- New tests use public start/startWithClock or render/ScrollHandle and the public TimelineRail component. The large 10,000-input geometry check costs about 15ms, while real-Run wiring uses representative small scenarios. Clipboard assertions exclude header/timeline glyphs; active Shift selection does not enter message mode. en/zh, small-resize release, permission ownership, separate Job/Subagent views, 59/60 columns, clear/new Session and resume defaults are covered.

## Verification before integration

- `rtk env -u NO_COLOR bun test apps/neant-tui/tests/e2e/message-navigation.test.ts apps/neant-tui/tests/components/timeline-rail.test.tsx apps/neant-tui/tests/e2e/tool-expansion.test.ts apps/neant-tui/tests/e2e/resume.test.ts packages/tui/tests/components/scroll-box.test.tsx packages/tui/tests/hooks/input.test.tsx`: 31 pass, 137 assertions, 3.78s. All modified cases <0.33s in this run. Resume replay switched to a shared virtual clock, 1.04s→0.32s; no fixed waits added.
- Focused coexistence: fullscreen, Subagent parity, text selection, tool windows and thinking passed. Background Job reading/update/resize and grouped Ctrl+O/Interaction cases passed separately (2 tests, 15 assertions); the existing real-process output watcher costs 2.57s because it exercises live child-process settlement and 350 streamed microtask updates. Existing fullscreen restoration case costs 1.08s and is unchanged.
- Legacy assertions updated for reference chrome: resumed message counts inspect the 78-column source area while retaining exact 12-line and nonduplication checks; logo position accounts for the reading header. Tool expansion now waits for the painted reading header before capturing body rows, and intentional separate clicks use virtual 500ms spacing so multi-click text selection does not consume the second activation.
- `rtk bunx --no -- tsc -b`, `rtk bunx --no -- oxlint`, `rtk bunx --no -- knip`, formatting and `rtk git diff --check` passed. Initial static errors from a foreign test-helper import, unsupported border property and broad color type were fixed in their owning modules. No aggregate gate run here; the orchestrator owns the single final integrated gate.

## Integrated verification and review

- Synced integration `c639557527b2b8789e976754937cfc34844deac5` through merge `86d680e`; no conflict. Native Subagent Run-history boundaries and both-endpoint held-selection behavior remain owned by their integrated modules. Screen border painting retains the new immutable selection viewport metadata.
- After sync, public message-navigation/timeline/ScrollBox/input checks: 21 pass, 60 assertions, 2.67s. The actual Chat held-drag wheel/copy regression passed separately: 1 test, 4 assertions, 0.33s. Post-sync `tsc -b`, `oxlint` and Knip passed. Formatting and diff check passed before evidence commit.
- Standards review: dependency direction stays app screen → app timeline component → public design system/renderer; actual user inputs define navigation boundaries. No Agent Core or persistence change is introduced by this ticket. Renderer anchors and border style are public presentation capabilities; locale copy and existing permission/terminal restoration paths are reused. No private navigation state assertions or fixed cleanup sleeps were added.
- Spec review: all eight criteria are covered by the new public scenarios and affected existing ownership tests. Thinking, tool and Job Ctrl+O union remains in the existing shared toggle path. Background Job/Subagent remain separate entries; real-Run tests verify skip/owned views. Public geometry handles current content, source remounts and disappearing detail; new Session/default resume, existing fullscreen/new-output/small-terminal restoration and clipboard ownership checks passed. The orchestrator will perform the final aggregate gate on the integrated feature.
