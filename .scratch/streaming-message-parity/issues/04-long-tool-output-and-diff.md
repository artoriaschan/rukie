# 04: 长工具结果与 diff 浏览

Status: resolved
Blocked by: 03

**What to build:** 用户能完整检查长工具输出和文件变化，窄宽终端切换、内容窗口与截断披露明确，重要执行结果始终可见。

规范用户故事：16–21、23–25、48、55、60–61。

以 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 和父规范为准。保留 Neant 品牌、中英 Locale、Session 权限与生命周期；缺失信息不伪造，不新增老会话兼容。必要数据、消费者、公开行为测试和所属文档在本工单一起交付，使用现有 start/startWithClock 与必要的 createSession 入口。开发运行最小受影响检查，代码交付遵循仓库完整验证规则。

## Acceptance criteria

- [x] 普通工具输出三行和 diff 八行预算按参考实施，换行及视觉宽度计算覆盖中文、Unicode 和长行。
- [x] 自动 diff 布局在 109 列单栏、110 列及以上双栏，缩窄后正确恢复；保留已有显式布局选择，样式及对应行按参考对齐。
- [x] 展开提供 400 行窗口与当前范围说明，用户能继续浏览窗口之外的内容；覆盖窗口头尾和跨窗口操作。
- [x] 完整源不可用、截断或输出缺口明确披露，不能将可见窗口或部分源称为完整结果；退出码、信号和必要错误不被预算隐藏。
- [x] 折叠、展开、窗口移动和 resize 保持阅读锚点，文件路径操作和内容浏览互不误触。
- [x] 新会话恢复对已保存内容采用相同布局及披露规则；不能恢复的完整源按事实说明，不回填老数据。
- [x] 复用工具和 diff 的公开测试入口，TUI 覆盖 109/110 列边界、展开、窗口浏览及披露；大样本通过所属模块公开行为低成本验证。
- [x] 验证相关颜色和中英文提示；针对超过一秒的用例检查重复渲染、真实等待与清理成本。

## Implementation and verification

- 400-row windows have pointer Previous/Next controls and explicit retained range. Pointer activation gives one card keyboard ownership; arrows, PageUp/PageDown, Home/End move its window, Escape releases ownership. Typing, pointer selection, wheel, focus loss, collapse and unmount release ownership; the provider lifetime follows Session identity.
- Unified source identities survive split alignment, including unequal paired replacements and unpaired insertions. Split ranges explicitly count aligned rows and separately disclose retained unified source rows. 109/110 resize round-trips preserve source offsets; both pane anchors are available to scroll retention. Explicit layout settings remain honored.
- Folded logical lines wrap with a Unicode-safe 1000-unit preview and hidden-character count; expansion restores retained text. Status, hover arrows, gutters, splitter rails and window controls use renderer selection exclusion. Public drag coverage verifies source-only copy and suppresses fold/path action wiring.
- Search totals greater than retained matches disclose unavailable output. Web Tool View retains the actual saved download/character truncation fact. Resumed web/read cards keep disclosures outside every fold/window and never rerun tools. Patch-only diffs disclose retained hunks and unavailable source outside hunks; they are not labeled full files.
- README contracts updated. Standards/Spec self-review checked source ownership, locale parity, public testing seams, lifecycle cleanup, range terminology, and reference 3/8 +1 grace and 109/110 split behavior. Browsing beyond 400 rows is the explicit spec extension, absent from the fixed reference.
- Red reproduced: missing next-window controls, undisclosed line clipping, result gutter copied, hidden search truncation, hidden web truncation. Updated inherited web title expectations from legacy parentheses to reference space-separated structured title. Unequal replacement fixture uses case-equivalent source lines so the reference alignment pairs them; entirely unrelated unequal blocks correctly remain unpaired.
- Focused verification: `env -u NO_COLOR bun test` on tool-windows, split-diff, tool-expansion, transcript-search, text-selection, web-fetch, public renderer split-diff, and Agent Core remaining-tool-views: 49 tests / 167 assertions pass (7.11s). New app cases 104–485ms; public 2,601-row identity test 3.2ms. Existing search reading-position case improved from 1,186.87ms real time to 164.80ms with startWithClock, preserving assertions.
- `bunx --no -- tsc -b`, `bunx --no -- oxlint`, formatting and `git diff --check` pass. Aggregate delivery gate belongs to the integration owner after all dependent tickets merge.

- Integration sync: merged `5d5a28a` (selection gestures/clipboard); retained both README contracts and the renderer `event.handled` priority before frontend window ownership. Post-sync tool-window and selection suite: 16 tests / 69 assertions pass (3.17s); typecheck passes.

- Additional post-sync public selection checks drag across visible status/hover arrow and source body, and across both split panes; copied text excludes status marker, arrow, body gutter and splitter rail, and the card stays expanded/folded as before the gesture. Tool-window file: 7 tests / 52 assertions pass (1.99s); targeted hover-copy test, types and lint pass after the final test additions.
