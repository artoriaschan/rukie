# 09: 完整选字与终端剪贴板适配

Status: resolved
Blocked by: 08

**What to build:** 用户可以双击、三击或用键盘延长选区，在本地、tmux 和 SSH 会话中复制到正确位置，并在流式或布局变化时获得准确结果。

规范用户故事：49–53、56、58–60。

以 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 和父规范为准。保留 Neant 品牌、中英 Locale、Session 权限与生命周期；缺失信息不伪造，不新增老会话兼容。必要数据、消费者、公开行为测试和所属文档在本工单一起交付，使用现有 start/startWithClock 与必要的 createSession 入口。开发运行最小受影响检查，代码交付遵循仓库完整验证规则。

## Acceptance criteria

- [x] 双击、三击和键盘延长选区的范围、完成及自动复制行为对齐参考，鼠标和键盘选择使用同一事实校验路径。
- [x] 覆盖 Unicode、跨行、Markdown、工具正文及其他可选择消息；隐藏内容与不可选择的卡片装饰遵循参考，选择不触发卡片动作。
- [x] 平台剪贴板与 OSC52 处理、tmux 包装及必要本地 fallback 对齐参考，SSH 不写远端本地剪贴板；不依赖用户真实剪贴板完成自动化测试。
- [x] 复制后清除高亮，失败或选择内容变化时拒绝复制并提供中英提示，不能把复制失败报告成成功。
- [x] 折叠、展开、滚动、resize 和流式替换期间校验原选区内容，失效选区不能跨 Session 残留。
- [x] 输入协议能够识别的修饰键按参考处理；选择键与编辑、审批、退出不冲突，不能因桌面平台假设吞掉终端输入。
- [x] 通过现有 TUI host 注入验证实际复制结果，通过公开 terminal 边界验证 OSC52/tmux/SSH 可观察输出和本地 fallback 策略。
- [x] 虚拟时钟覆盖多击与键盘选择时间边界，清理恢复时钟和终端；小终端和关闭不回归。

## Implementation and verification

- Renderer owns click-chain and word/line spans over painted glyph metadata. Double press selects Unicode/path words, triple and later presses select a visual row; drag extends complete units. Strict `<500ms` and per-axis `<=1cell` boundaries, modified press reset, wide grapheme ownership, and shared stale-copy validation follow the fixed reference. Active pointer gestures accept Shift arrows/Home/End before frontend handlers; with no gesture keys retain frontend ownership. Disabled transcript regions during Interactions/modals/small terminals reset gestures and click chains.
- SGR mouse/motion/wheel preserve shift/alt/ctrl. Main injects its environment/stdout into the default host. Native helpers are platform-specific with cached Linux winners and a 2000ms kill deadline; SSH_CONNECTION skips remote native writes. tmux load-buffer success emits escaped DCS OSC52, iTerm2 omits `-w`, failure falls back raw; Kitty uses ST, other terminals BEL, screen DCS. Host disposal cancels helpers and prevents late transport output.
- Clipboard results distinguish actual helper/tmux-buffer exit-0 (`true`), failure (`false`), and unacknowledged OSC submission (`sent`). Selection, file actions and OAuth consumers use honest localized feedback. OSC52 receipt by the terminal is inherently unconfirmed.
- Red: immediate double-press highlight and keyboard completion failed before implementation. A later ownership regression showed repeated file menu presses becoming text selection; resetting chains when their region disappears restored ordinary menu behavior. Final host tests use synthetic PATH helper programs and exact stdout capture, never a real clipboard; process-ready signals and virtual 1999/2000ms assertions bound helper waits.
- `rtk proxy env -u NO_COLOR bun test apps/neant-tui/tests/host/write-clipboard.test.ts apps/neant-tui/tests/e2e/selection-gestures.test.ts apps/neant-tui/tests/e2e/text-selection.test.ts apps/neant-tui/tests/e2e/file-actions.test.ts apps/neant-tui/tests/e2e/mcp-auth.test.ts packages/tui/tests/hooks/input.test.tsx`: 54 pass, 146 assertions, 7.18s before final Interaction/wheel/deadline-extra assertions. Latest gesture file: 12 pass, 25 assertions, 1.46s; latest host/input: 7 pass, 26 assertions, 1.16s. New individual cases stay below 410ms.
- `rtk proxy bun run check:dev`: passed; docs/ADR updated. Parent integration owns final aggregate verification.
- Development incident: the first red host run called the old constructor before its options existed, unintentionally reaching real macOS pbcopy exit-0 for `中文🐋` and then `hi`. No clipboard reads or attempted restoration; parent notified for disclosure. Fixtures now use isolated fake PATH before invocation, and SSH gating is implemented before those tests run.

### Final focused gate

Selection/host/input/file/OAuth plus fullscreen/hover/terminal lifecycle: 83 pass, 296 assertions, 9.33s after all code changes. Existing fullscreen scroll/exit case remains 1.08s; new cases are below 324ms in this run. Host timeout and disposal coverage confirms no late OSC after close and rejects future writes. `rtk proxy bun run check:dev` and `rtk git diff --check` pass. Branch based on integration `4066a6a`; final parent-tip synchronization is recorded in Git.
