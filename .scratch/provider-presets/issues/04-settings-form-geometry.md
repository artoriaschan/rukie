# 04：设置区表单间距、输入高度与圆角

Status: resolved

**What to build:** 按 [spec 设置区样式](../spec.md#设置区样式)和已确认的 rukie.pen C11、C16 统一设置区表单几何，同步 DESIGN.md。这是用户授权的布局变化，按 [DESIGN.md 布局保护规则](../../../DESIGN.md#layout-preservation)执行。

- [x] 改动前在 Chromium 测量基线：C11 三组字段的标签与输入框位置和高度、模型列表起点；C16 各字段组；宽屏与窄屏，Light 与 Dark
- [x] 补齐缺失的布局用例，断言标签到控件 4px、输入框与 Select 高 32px、圆角 8px、C11 模型列表起点 291px；Checkbox 与 Radio 选项外框圆角 8px、高 28px；弹窗按钮保持 12px
- [x] 修改 `model-services.css`、beUI Input/Select 在设置区的作用域样式，以及 C16 选项外框样式；不改变设置区以外 A02/A03 消费者的几何
- [x] DESIGN.md "Model services settings"同步数值：30px 改 32px，36px 控件与 60px 字段组改 32px 与 54px，64px 字段组重复间距改 69px，276px 改 291px，标签间距 4px，表单控件圆角 8px
- [x] 运行设置区布局回归（`model-services.browser.test.tsx`、`layout.browser.test.tsx`，以及 shell 中涉及设置区的用例），记录基线、授权差异与实测结果

## Comments

- Implementation complete in `style/provider-presets-04`; final integrated review and GUI acceptance remain with ticket 06.
- Pre-edit Chromium baseline (1887 × 1210 and 420 × 1210, Light/Dark): C11 label gaps 1px, bordered controls 30px, list offset 276px; C16 gaps 6px, bordered controls 36px, single-line groups 60px, Select 36px/60px, radio 28px/999px, checkbox 28px/8px. Raw field positions are saved in `/tmp/rukie-provider-presets-evidence/04-baseline-all.log` (diagnostic measurement assertions before production edits).
- Authorized result: gaps 4px, bordered Input/Select controls 32px/8px, C11 first field repeat 69px and list offset 291px, C16 single-line groups 54px (wrapped labels grow), option shells 28px/8px. Input internals are 30px inside 1px borders. Modal actions retain 12px corners and 36px height. Changes are scoped to model services; shared primitives untouched.
- Unchanged panel bounds: wide x660/y188/880×560; narrow x64/y204/344×580. Shell/Conversation/composer geometry and settings focus restoration regressions passed.
- Focused Chromium: from `packages/ui`, `rtk proxy bunx --no vitest run --config vitest.config.ts --project ui-browser tests/app/model-services.browser.test.tsx tests/app/layout.browser.test.tsx tests/app/shell.browser.test.tsx`: 38 passed, 19.34s. Initial geometry tracer passed after its red failure, 2 cases/1.51s. Logs and verification ownership are in `/tmp/rukie-provider-presets-evidence/verification.md`; no real Electron, credentials or production data.
- Removed two catalog paragraph CSS rules at ticket 01 owner's request; its subtitle consumer is removed by ticket 01. Aggregate static/docs and final package/browser acceptance are coordinated by integration owner/ticket 06.

### 集成交付验收（2026-10-13）

功能范围内实现、消费者、文档和四项评审修复完成。证据见 [验证记录](../verification.md)：桌面 150 个用例组合通过，定向 payload/schema/server/icon/布局与 Chromium 验收通过；完整 Bun 实际 3507 通过 / 25 失败，混合 TUI 失败未分类，其他失败家族有独立基线/环境证据。CI 待验收，真实接口及正式 Electron 待用户验收，resolved 不表示全量接受或已合并。
