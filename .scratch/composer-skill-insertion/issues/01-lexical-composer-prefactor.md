# 01：主输入框换成 Lexical（预重构）

Status: resolved
Blocked by: None (can start immediately)

**What to build:** 按 [spec](../spec.md) 的「编辑器」一节与 [ADR-0048](../../../docs/adr/0048-lexical-composer-editor.md)，把桌面与 Web 主输入框从 textarea 换成 Lexical 纯文本编辑器。用户感知不到任何变化：发送内容、键盘行为、图片附件、焦点与尺寸都与现在一致。这一步只为后续技能标记腾出编辑器模型，不新增功能。

- [x] 新增 Lexical 依赖，精确锁定版本，更新 tech-stack 与 Bun 锁文件
- [x] 输入框对外仍以纯文本草稿和图片作为发送输入，所有调用方无需改动语义
- [x] 回车发送、Shift+回车换行、输入法合成期间不发送、图片粘贴、焦点交接、禁用与提交中状态与现在一致
- [x] 自动增高与输入框几何不变，布局保护流程下现有基线无差异
- [x] 现有输入框、紧凑输入框、输入焦点浏览器测试全部通过，不削弱断言；新增 Lexical 相关回归覆盖输入法与粘贴
- [x] 受影响的类型检查、oxfmt、oxlint、knip 通过

## Comments

- Fresh implementer owns `feat/composer-ticket-01` in isolated `/tmp/rukie-composer-01`; integration ancestry verified. Public seam is the spec-approved Chromium PromptInput/Composer/App DOM and submitted inputs.
- Retain installed beUI PromptInput and toolbar; Lexical replaces only the editor surface per ADR-0048. No geometry changes authorized. Focus consumers include goal toggles, App focus restoration, approval completion and plan-pane return.
- Before implementation: existing composer, compact-composer, input-focus and full-page layout cases passed 22/22 in 3.80s. These cover wide/narrow, font scaling, title bar/sidebar, Transcript and dock positions.
- Red: new contenteditable/IME/multiline/plain-text paste test fails on the old textarea (1 failure, 2 skips, 15.56s; missing contenteditable). Green: same case passed in 744ms. An intermediate startup failure was Vite's newly discovered Lexical dependencies reloading the test; explicit optimizeDeps entries resolve it. An intermediate clear assertion incorrectly expected a new value callback; existing uncontrolled behavior clears DOM without calling onValueChange, so it now asserts exact visible draft instead.
- Draft assertions move from textarea.value to exact rendered editor text, preserving whitespace and newlines; placeholder checks target the rendered pseudo-element. 23/23 composer/compact/input-focus/layout cases pass after migration in 3.71s.

- Consumer verification: 124 selected Chromium cases across shell, Transcript, Goal, Plan Mode/Pane/Review, questions, model services and semantic roles: 122 passed, 2 failed in 24.96s. Failures were diagnosed individually: Goal placeholder assertions still used textarea attributes (moved to aria-placeholder), and a native isComposing Enter could reach Lexical and insert a newline. Capture now leaves IME confirmation to the browser, preventing Lexical insertion. The two affected cases pass (2 passed, 38 skipped, 1.76s); other 122 results remain valid. App integration cases use a real local wire fixture and browser interactions, explaining cases above one second; the added isolated editor cases each complete below one second.
- Final affected editor/placeholder/image checks: 3 passed, 34 skipped in 1.38s, including rich HTML paste falling back to text/plain and App pasted/dropped images preserving draft through disconnect. Disabled/submitting test: 1 passed, 3 skipped in 764ms; draft whitespace, noneditable disabled surface, not-allowed cursor and send rejection remain intact.
- `bunx --no tsc -b packages/ui` initially failed on the Lexical placeholder prop union and DOM helper's HTMLElement constraint. Using the lower-level documented ContentEditableElement for the existing pseudo-placeholder and narrowing Element at runtime fixed both; UI typecheck then exits 0. Focused oxlint exits 0. Final static aggregation (including Knip), package/full acceptance and manual browser verification remain coordinated by the parent. No native Electron launched.
- ADR coverage: editor ownership and serialization follow ADR-0048, with no changed decision; tech-stack records exact Lexical packages and versions. Ticket remains claimed until independent review and parent integration acceptance.

- 2026-10-16 交付关闭：实现、维护文档与两路独立评审修复已完成；主代理适用本地验证、失败聚类与增量复验、Chromium 截图及 ADR Coverage 结论见 [最终验收](../verification.md#最终交付验收--2026-10-16)。PR [#42](https://github.com/artoriaschan/rukie/pull/42) 等待最新 CI 与用户评审；resolved 不表示已合并。原中间结果与 claimed 历史记录保留。
