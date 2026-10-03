# 04: 多题切换

**What to build:** 模型一次提 2–4 题时，用户在同一提问框内逐题作答，可来回切换修改，最后一题确认后整批提交；模型收到每题一行的结果。

**Blocked by:** 02（单题单选端到端提问）

**Status:** resolved

参考：[spec](../spec.md) TUI 提问框键位。与 03 同改提问框组件，建议串行以避免冲突。

- [x] 显示进度（第 n / 共 N 题）与当前题 `header`
- [x] `tab`/`←→` 切换题目，已答内容保留可回改
- [x] 确认一题自动进入下一题；最后一题确认后提交整批
- [x] `esc` 在任意题上拒绝整个调用
- [x] 结果每题一行，顺序与问题一致
- [x] TUI seam 测试覆盖切换、回改、整批提交

## Answer

已在同一底部提问框支持 1–4 题逐题作答：显示当前题进度与 header，Tab/左右循环切题，确认后自动进入下一题，最后一题确认后按题目顺序提交整批回答。若切题跳过未确认题目，最后确认会回到首个未确认题，保留之前的草稿。

每题的选择、多选勾选、Other 编辑状态与自由文字都由 chat screen 的外置 Interaction store 保存；切题后可回改，已确认的 Other 退出编辑后也能重新改选。任意题及 Other 编辑期间 Esc 均拒绝整个调用。共享 FIFO、单题键位、prompt 草稿隔离及 Ctrl+C 取消保持既有行为；本工单未扩展 05 transcript 摘要。

实现提交：`d775ea0`（`feat(tui): support navigating multiple user questions`）。

### Validation

- TDD 的首个公开 seam 红测复现了缺少多题进度/自动下一题，复杂四题回改红测复现并修复了已确认 Other 回访时无法改选；40×12 双语红测发现并修复新增切题提示挤掉拒绝提示。
- `start()` + `controlledModel` TUI seam：`bun test apps/neant-tui/tests/e2e/questions.test.ts`，26 pass / 0 fail。新增覆盖四题前后切换、单选/多选及 Other 草稿回改、自动下一题、结果顺序、跳过题目的确认、任意题 Esc 与 zh/en 进度/header/窄矮提示。
- `bunx tsc -b` 通过。
- 临时 HOME 已核对 `node:os.homedir()` 指向该目录。`rtk proxy env -u NO_COLOR HOME=<issue04_test_home> bun run check` 通过：format、lint、typecheck、Knip、662 pass / 0 fail，55 files；未修改真实用户设置，验证后清理临时目录。
- `/code-review` 固定点 `9f841aa`，两个并行独立轴均通过：Standards 硬性违规 0 / judgment smell 0；Spec 缺失或部分实现 0 / scope creep 0 / 错误行为 0。
