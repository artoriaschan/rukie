# 01：外壳三栏底色与工作区阴影

Status: resolved

**What to build:** 按 [spec](../spec.md#外壳三栏底色与工作区阴影)，把 C01 外壳的三栏底色更新为 DESIGN.md 中的新值，并给中间导航加主内容组成的内侧工作区加上两层外阴影，主页与设置页都生效，几何不变。

- [x] 开始改动前运行 layout 浏览器测试，记录 layout preservation 基线
- [x] 更新 `layout-rail`、`layout-titlebar`、`layout-sidebar`、`layout-content` 的 Light/Dark 值；`layout-divider` 不变
- [x] 新增 `layout-shadow-near` / `layout-shadow-far`，只在内侧工作区容器上合成 `0 2px 8px` 与 `0 8px 24px` 两层外阴影，跟随 12px 圆角，位于外层窗口裁剪内
- [x] 设置页显示同样的三栏底色与工作区阴影，设置内部作用域 token 不变
- [x] layout 浏览器测试改为断言新底色，新增阴影断言（Light/Dark 两层值，只在工作区容器上）；几何断言保持不变并通过
- [x] DESIGN.md 三栏底色与阴影段落与实现一致（当前分支已有修改），确认无遗漏
- [ ] 受影响页面的 agent-browser 截图：主页、会话、设置，Light/Dark 与窄宽度（由 06 统一最终验收，见下方记录）

## Comments

### 实施与 focused 验证（2026-10-14）

- 实施分支 `feat/shell-palette-01` 基于 integration `b0f50385`；交付前已快进合入 integration `e1677d33`。Pencil MCP 读取 C01 `pwNR9` 和六个 layout 主题变量，与 DESIGN.md 的四底色和两层阴影规则一致；无需修改现有 DESIGN.md。
- `theme.css` 更新四个结构底色，保留 divider；两层阴影共用一个声明，分别用于当前聊天或设置工作区。设置覆盖聊天时取消 inert 聊天工作区的阴影，确保深度只出现一次。没有改动 DOM、布局尺寸、设置内部主题 token、依赖或锁文件。
- 改动前既有布局与设置几何 7 例通过；原有设置焦点用例在改动前失败（`model-services.browser.test.tsx:684`），完整基线结果为 7 passed / 1 failed / 34 skipped，19.55s。该失败与本票底色和阴影修改无关，未修改其实现或断言。
- 新增真实 App 设置工作区的宽/窄布局基线后，按 TDD 分别证明旧底色和缺失设置阴影会失败，再验证新实现。最终命令 `bunx --no vitest run --config /Users/chenzheng/.codex/worktrees/shell-palette-01/rukie/packages/ui/vitest.config.ts --root packages/ui --project ui-browser tests/app/layout.browser.test.tsx`：6 passed，3.94s。覆盖主页、会话、Light/Dark、宽/窄、文字缩放、侧栏开合、滚动与 resize，以及设置完整工作区的底色、独立内部表面、1px 接缝、12px 圆角、单一阴影和窗口 overflow 裁剪规则。
- 保留既有几何：宽屏聊天/设置为 `(52,44)`、右/下 4px 留白；聊天窄屏布局及 overlay 侧栏不变。设置在现有 `max-width:640px` 规则下为 left/right/bottom 0、52px 导航、内容 left52，已测量并由验证负责人确认保留；没有将宽屏 inset 强加给窄屏。
- `bunx --no oxfmt` 格式化两个改动文件，`bunx --no oxlint packages/ui/tests/app/layout.browser.test.tsx` 通过。完整静态检查、适用 desktop 包级验收及最终 agent-browser 主页/会话/设置的 Light/Dark 和窄屏截图统一交给 [06](06-acceptance.md)，本票不重复运行。详细命令、失败与有效性记录位于验证负责人提供的 `/tmp/rukie-shell-palette-evidence/ticket01.md`；本票 resolved 表示实现和本地 focused 要求完成，最终 GUI 证据由 06 补齐。
- ADR Coverage：沿用 spec 中局部外壳视觉规则“无需 ADR”的记录；本票只修改呈现 token 与现有容器的深度，不改变模块、依赖、协议、信任或资源生命周期。

- 2026-10-14：最终本地集成验收由 [06](06-acceptance.md) 完成，包含 applicable static 增量组合、首次 desktop 整包实际失败及对应 focused 修正、隔离 GUI 与 ADR Coverage；本票与 spec 同步 resolved。详细边界和实际结果以 06 最新记录为准，不代表 CI 或 PR 合并已验收。
