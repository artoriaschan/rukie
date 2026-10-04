Status: done

# ask_user_question 上下选择布局稳定性

2026-10-04 用户要求：`ask user 工具选项在上下选择时，被选中的选项高度会变化导致抖动，修复这个问题`。

- 同一问题上下切换选项时，各选项标签与描述保持原有行位置和高度；焦点只改变指针、图标、颜色和加粗。
- 进入或离开常驻自定义回答行时，提示文案可以更新，但其预留高度与选项窗口预算保持稳定，不能带动问题面板与 Todo 上下移动。
- 空间不足时保留现有选项窗口滚动；窗口的行位置与容量不因焦点进入自定义输入而改变。Todo 与 question 继续共存，状态栏可见。
- 本次明确修正优先于之前 dsh 复刻中按焦点添加上边距的行为；其余回答、折叠、粘贴与工具结果语义沿用既有规格。

公共验证 seam：现有 `start` + controlled model + headless terminal，读取真实终端单元格行位置。宽裕窗口覆盖 40/80 列、中英文、单选/多选、不等长描述，以及选项与自定义输入间的上下往返；40×12/16/20/24 窗口覆盖 Todo 共存、选项窗口位置与容量。

基线：`e262e208a46b4a8cddfe15d252c23a5850fdec2f`。

TDD：新增的 8 个宽裕窗口用例在原实现均失败，焦点移动使原选中标签与描述上移一行。移除焦点边距后，多选窄窗口进入输入仍使面板位移一行；为两种提示文案统一预留高度后用例通过。

验证：专项 82 pass / 0 fail，453 assertions。完整 `rtk proxy env -u NO_COLOR caffeinate -is bun run check` exit 0；format、lint、typecheck、Knip 通过；752 pass / 0 fail，4750 assertions，61 files，108.47 秒。完整日志：`/tmp/neant-question-layout-check.log`。

实现提交：`a338258`。审查采用上述基线到实现提交的三点 diff。

## Standards

0 项发现。布局预算仍由 QuestionDialog 统一维护，符合 TUI 与 Agent Core 的职责边界；未新增依赖或本地化契约。测试通过真实输入和终端输出验证行位置，没有依赖组件内部状态。未发现需要修复的代码异味。此轴为只读源码审查，完整检查证据来自主代理。

## Spec

0 项发现。焦点变化不再修改选项与输入行上边距；两种提示文案统一预留高度，使宽裕判断、预算与选项窗口容量不依赖焦点。审查子代理独立运行新增布局回归：12 pass / 0 fail，196 assertions。验证使用公开应用入口与 headless terminal，未人工观察实体终端。

Standards 0 项；Spec 0 项；均无未解决问题。
