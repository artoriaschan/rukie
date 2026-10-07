# 03: 多选与"其他"自由输入

**What to build:** 模型提 `multiSelect` 题时，用户可勾选多项一次确认；任意题末尾固定有"其他"，选中后就地变为输入框，用户可只写自由回答，或在单选/多选之外附言。模型收到的结果反映所有选中项与附言。

Blocked by: 02（单题单选端到端提问）

Status: resolved

参考：[spec](../spec.md) TUI 提问框、结果文本。

- [x] 多选题 `space` 勾选/取消、`enter` 确认，结果为 `"问题" → A, B`
- [x] 每题末尾固定"其他"项，选中变单行输入框，`enter` 提交，换行压平
- [x] 仅"其他"时结果省略选项部分；选项 + 附言为 `→ A; 附言`
- [x] 输入框内按键不改 prompt 草稿；`esc` 仍拒绝整个调用
- [x] 新文案走 i18n（zh/en）
- [x] TUI seam 测试覆盖多选、仅"其他"、选项 + 附言

## Answer

已交付多选与“其他”单行输入。数字/上下键定位，Space 勾选或取消，Enter 确认；每题最后固定“其他”，Enter 或 Space 在原位置打开输入框，再 Enter 提交。单选 Enter 继续直接确认；需要附言时先 Space 保留一个选项，再进入“其他”，提示随 zh/en 翻译。输入中的 CR/LF 压为空格，草稿保持独立，Esc 拒绝整个调用，Ctrl+C 取消 Run。

组件仅通过 props 呈现，回答状态由 chat screen 的外置 Interaction FIFO 管理；继续复用 Agent Core 的结果格式化，没有扩展多题导航或 transcript 摘要。

验证：

- 公开 `start()` + controlled model + 终端 stdin/screen seam：questions 17 pass、0 fail，覆盖多选切换、纯“其他”、单选/多选附言、换行压平、同 chunk 输入提交、Esc/Ctrl+C、草稿保持、zh/en、40×12 长文本及既有 FIFO/多行模型文案回归。
- `rtk proxy bunx tsc -b` 通过；`rtk git diff --check` 通过。
- 使用新建临时 HOME 并确认 `node:os.homedir()` 指向该目录，执行 `rtk proxy env -u NO_COLOR HOME=<temp> bun run check`：format、lint、typecheck、Knip、653 tests / 55 files 全通过（0 fail）；临时目录已清理。
- 固定点 `1ed95aedf997fa16e25eb212fe058319ebb0500d`，两轴独立并行审查完整工作区 diff：Standards 硬性违规 0 / smell 0；Spec 缺失或部分 0 / 范围扩张 0 / 错误行为 0。Spec reviewer 额外通过公开 seam 核对 40×12/en 多选取消、纯“其他”、两选项附言及 CRLF 压平。
