# 02: 替换 TUI 其余界面文案

Status: resolved

**What to build:** 英文环境下 TUI 所有界面文案为英文、中文环境下为中文，不再中英混杂。覆盖现有中文硬编码与英文硬编码两类。见 spec Implementation Decisions 的 TUI 节替换清单。

Blocked by: 01

- [x] 状态栏：切换提示（`shift+tab`）、缓存命中率、`esc` 中断、上下文分段名（system / prompt / assistant / thinking / tools 及缩写）、`ctx`、`tps`；zh 中技术缩写可保持原值
- [x] 审批对话框：标题、问题、按键提示
- [x] 回到底部徽标、上下文用量警告、窗口过小提示
- [x] compaction 通知、MCP server 错误通知
- [x] settings warning 前缀、argv 校验错误、非交互终端提示；argv 报错发生在 settings 加载前，只按环境变量解析 locale
- [x] 文案进 TUI 字典（zh 基准 + en `satisfies`），③ 组件仍只收 props
- [x] 测试：TUI 字典每个 key zh / en 占位符集合一致；e2e 覆盖 en 下上述各处文本
- [x] `tsc -b` 与全部测试通过

## Comments

2026-10-03: 已完成。新增 TUI zh 基准 / en `satisfies` 字典；状态栏切换、缓存、中断、完整上下文分段名与详情标签、审批标题/问题/按键提示、回到底部徽标、上下文警告、窗口过小提示、压缩与 MCP 通知、启动 warning 前缀及 argv / 非交互终端提示均按 locale 显示。原有欢迎栏 `High effort` 也作为现有界面文案迁入字典，组件仍仅收 props。技术缩写保留；Core/schema 错误详情原样展示。本票未改 activity 句池/narration（03）、Agent Core 错误码（04）或扫描测试（05）。

提交：`8634538`（界面文案）与 `00663db`（审查修复）。公共 seam：`main(argv, io)` / 既有虚拟终端 `start()`；argv、审批、状态栏、徽标、通知等逐片先红再绿。新增字典占位符一致性检查；zh/en MCP 与 compaction 保留颜色、单行及隐藏 summary 的行为覆盖。

验证：`rtk proxy bunx tsc -b` 通过；审查修复后 focused locale/fullscreen 40 tests / 150 assertions 通过；最终 `rtk proxy env -u NO_COLOR bun run check` 通过（格式、lint、tsc、Knip、549 tests / 3066 assertions，50 files）。

固定点 `9e8f182` 的双轴 `/code-review`：Standards 0 findings；Spec 1 项 P2：非交互终端提示未遵循 settings locale 覆盖。新增非 TTY 用户 zh / 环境 en 回归测试确认 red，终端检查移到 settings / locale 解析后并改用启动 `t`，测试 green；Spec 原审查代理复核确认已解决且无新增问题。最终无未解决发现。
