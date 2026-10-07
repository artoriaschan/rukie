# 08: 拖动选字与自动复制

Status: resolved
Blocked by: 01

**What to build:** 用户能在真实会话正文中拖动选择并自动复制，流式变化不会造成错误复制，复制完成后选区清理且卡片动作不被误触。

规范用户故事：49–51、53、56、60–61。

以 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 和父规范为准。保留 Neant 品牌、中英 Locale、Session 权限与生命周期；缺失信息不伪造，不新增老会话兼容。必要数据、消费者、公开行为测试和所属文档在本工单一起交付，使用现有 start/startWithClock 与必要的 createSession 入口。开发运行最小受影响检查，代码交付遵循仓库完整验证规则。

## Acceptance criteria

- [x] 自有会话选区支持拖动选择实际显示的文本，覆盖多行、Unicode、中文与 Markdown，复制内容对应用户选中的文本而非装饰或隐藏内容。
- [x] 选择完成通过现有 host／terminal 边界执行复制并清除高亮，剪贴板失败或不可用有明确反馈。
- [x] 复制前校验选择对应内容；流式替换改变了所选内容时拒绝复制并提示，不能复制用户没有选中的新内容。
- [x] 拖动与普通点击的手势边界清楚，选择正文不触发工具路径、图片、折叠或其他卡片动作，空白区域不误触。
- [x] 选区由 renderer 所属能力维护，保持 Agent Core 无关；遵循 ADR-0006 的自有选字决定，不新增产品测试接口。
- [x] 滚动、resize、内容重排及 Session 切换不会让过期选区复制错误内容；恢复和切换使用默认无选区状态。
- [x] 通过 start/startWithClock 输入真实鼠标事件、观察终端高亮并捕获实际剪贴板结果，覆盖成功、失败、流式替换和误触边界。
- [x] 保留退出终端恢复和小终端能力，文案中英对应；本工单完成基本复制闭环，额外选择手势与远程适配由 09 扩展。

## Implementation and verification

- Renderer-owned painted-cell selection tracks clipped glyph/source metadata, preserves Unicode graphemes and logical line breaks, rejoins soft wraps, and supports inherited `selectable={false}` decorations. Main Chat opts its ScrollBox into host clipboard copying; Agent Core remains unchanged.
- Drag suppresses card/path release actions; plain clicks retain existing behavior. Copy always clears highlight, reports unavailable/rejected clipboard honestly in zh/en, refuses changed selected bytes, and allows updates outside the selected range. Resize, Escape, region/session identity changes and unmount invalidate gestures; wheel and bottom-follow preserve the translated gesture and outgoing painted rows; late host results cannot notify a replacement Session.
- Red: initial public mouse-drag test timed out waiting for a painted highlight before implementation. Wide-continuation duplication and wrapped/newline projection regressions were reproduced and corrected through public app tests.
- `rtk proxy env -u NO_COLOR bun test apps/neant-tui/tests/e2e/text-selection.test.ts`: 8 pass, 20 assertions, 980ms. Covers forward/reverse and inert blank drags, Unicode Markdown, both clipboard failure outcomes/locales, streaming replacement/outside append, resize/clamped-wheel/Escape, path action suppression, softwrapped code and stale Session feedback; all app timers use virtual clocks.
- Related message/file-action/fullscreen/hover/terminal/input/text-style/scroll/frame checks: 69 pass, 368 assertions, 6.10s before the final two extra reverse/blank assertions. Existing fullscreen terminal integration remains the only case above one second (1.08s); new selection cases are below 170ms.
- `rtk proxy bun run check:dev`: passed. Renderer/app READMEs and ADR-0006 record the basic copy closure; ticket 09 retains extra gestures and remote adaptation. Parent integration owns the final aggregate check.

### Integration follow-up

Merged thinking baseline `d836e97` (merge `ca6be5b`), preserving dimmed Markdown and selection docs. A new public drag test first failed with copied `│first secret`; excluding ThinkingRow spinner/anchor and preview rails corrected it and retains ordinary header clicks. After integration: selection/thinking/messages 23 pass, 105 assertions, 2.88s; `rtk proxy bun run check:dev` passes. Tool card decoration follow-up awaits ticket 03's integration and is coordinated by parent.

### Integration follow-up: held selection while scrolling

- Fixed a reference parity gap: wheel and the shared redraw callback cleared a held gesture. Renderer now captures selected outgoing rows from the previous painted frame and translates both endpoints with the owning innermost scroll viewport. New pointer movement can extend it; entirely offscreen release discards it. Terminal resize, Session/modal invalidation, copy clearing and stale feedback remain intact.
- Fixed reference `3c89ea516e4f7d2777efe979200016528722a0b4`: actual `selection.ts` follow code translates both raw endpoints, despite the nearby Ink comment describing fixed mouse focus; release does not reset focus from pointer coordinates. This follows executable reference behavior.
- Public RED: unchanged renderer copied no bytes after held drag + wheel (two failures, no-wheel control passed). Focused virtual-clock coverage checks both directions, partial outgoing rows, repeated round-trip, auto-follow, subsequent pointer extension, fully offscreen discard, Unicode/wide continuation, soft wrapping, NoSelect decoration, and selected source mutation versus unrelated updates. A public `startWithClock` scenario checks real Chat wheel input and original copied bytes. Focused pre-sync verification: renderer + Chat text selection + gestures + terminal lifecycle: 41 pass, 122 assertions, 2.73s; related scroll/hover/frame scheduling/resize: 16 pass, 59 assertions, 455ms. New owning renderer cases total 12, 28 assertions, 107ms alone; no new case exceeds one second. `rtk proxy bun run check:dev` and `rtk git diff --check` pass. The root agent owns final aggregate verification.

- After syncing integration `6c9692c`: owning selection + Chat copy + gesture files pass 34 tests / 81 assertions in 2.54s; `rtk proxy bun run check:dev` passes. Implementation commit `ae129eb`; merge `233caf2`. No aggregate suite was repeated here.
