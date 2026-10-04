# 01: 输入框上方面板固定顺序

**What to build:** 不加新功能，先让 TUI 输入框上方的区域可容纳子代理面板。chat 屏幕在一处声明从上到下的固定顺序：ScrollToBottom → ActivityLine → TodoPanel → (SubagentPanel 预留位) → QuestionDialog → PermissionDialog → PromptInput → StatusLine。审批框打开时 todo 面板不再隐藏。高度预算改为先满足 PermissionDialog / QuestionDialog，剩余行数分给面板；面板分到的行数不够展开时以 1 行折叠预览显示，不会消失。预算逻辑抽成面板可共用的函数，供工单 09 复用。

**Blocked by:** None (can start immediately)

**Status:** resolved

参考：[spec](../spec.md)「TUI」中的「面板顺序」。

- [x] 顺序在一处声明；审批框始终紧贴 PromptInput
- [x] 审批框或提问框打开时 todo 面板仍显示
- [x] 小高度下 todo 面板折叠成 1 行预览，不被隐藏
- [x] 现有 TUI e2e 测试按新布局更新，新增"审批框 + todo 面板同时显示"的快照测试
- [x] `tsc -b` 与全量 `bun test` 通过

## Answer

chat 底部区域在一处按固定顺序声明，保留工单 09 的 SubagentPanel 位置。审批和提问期间 todo 与 PromptInput 同时显示；展开的交互框拥有输入与 IME 光标，输入框只读但保留草稿。折叠提问框后沿用原来的输入编辑行为。

高度先保证交互框与 StatusLine。空间不足时 PromptInput 变为一行只读预览，todo 变为包含进度和当前项的一行折叠预览；自动折叠不修改用户保存的折叠选择。共享 `allocatePanelHeights` 已通过组件区公共入口导出，为工单 09 提供等分预算与各自最小展开高度的预览回退。

12 行审批框、todo、输入和状态栏可能占满窗口，此时 transcript 没有可见行，回到底部提示在预算不足时暂时隐藏，Ctrl+End 仍沿用原有处理。只读的一行草稿显示第一行；关闭交互后恢复原有编辑位置，完整草稿仍可提交。

验证：

- 修改前的相关 e2e 基线：60 pass / 0 fail（todo、permissions、questions）。
- 公开终端红绿测试覆盖审批与 todo 同时出现、顺序快照、12/24 行多行草稿、交互输入隔离、预算预览及返回提示挤占状态栏的回归。
- IME 和 todo 联合回归：49 pass / 0 fail；既有提问光标、折叠编辑、调整窗口和全文提交测试通过。
- `rtk proxy env -u NO_COLOR bun run check`：exit 0，990 pass / 0 fail，72 files，5404 assertions；format、lint、`tsc -b`、Knip 均通过。
- Standards 审查：组件 barrel 导出遗漏已修复并复审，无未解决问题。
- Spec 审查：无问题；未实现工单 09 的子代理面板 UI。
