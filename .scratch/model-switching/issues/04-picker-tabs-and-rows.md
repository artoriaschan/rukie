# 04: 面板 provider tabs 与模型行

Status: resolved

Blocked by: 03

**What to build:** `ModelPicker` 改为按 provider 分 tab 显示。见 spec 用户故事 1–5 与「TUI」部分。

- 可见 provider 的过滤和 tab 排序放在 `view/`；打开时停在当前模型所在的 tab 和当前模型上；每个 tab 单独记住焦点。
- 模型行显示“名称 + 灰色 spec”，当前模型标 ✓，名称和 spec 相同时只显示 spec。截断顺序：先截名称，最后截 spec。
- 空间够时显示能力摘要。
- 没有凭据的自定义模型置灰并标“未配置凭据”，按 Enter 只提示，不切换。
- 底部说明行显示；加载中和加载失败两种状态；zh 和 en 文案。

- [x] 终端断言：Tab / Shift+Tab 循环切换，切回原 tab 时焦点还在
- [x] 终端断言：重名模型（同名、不同 provider 或不同 id）各自显示出能区分的 spec
- [x] 终端断言：没有凭据的内置 provider 不显示；置灰的自定义模型按 Enter 时出现提示，模型不变
- [x] 终端断言：加载中时显示“加载中”，不先列出全部模型

## Comments

- 2026-10-10：使用新的 issue 04 implementer 与独立 worktree。`view/model-picker` 拥有 provider 可见性、排序及模型名称/spec 的截断投影；终端屏幕以同步 ref 保存 tab 与各 tab 焦点，模型行提供能力摘要、灰色 spec 和缺少凭据的不可切换提示。目录打开时先显示加载状态，失败时保留直接 `/model <spec>` 提示；加载完成通过打开状态身份检查，关闭后不会重新打开。zh/en 与 TUI README 已同步。
- TDD：view 投影先出现缺少模块的红灯，再实现可见 provider 与 spec 优先的截断。终端公共 `start` 覆盖当前 tab、连续 ↓/Tab/Shift+Tab/Enter、各 provider 同 id 模型、未经授权的自定义模型 Enter 仅提示，以及加载文字先于 provider 行出现。没有新增 renderer API 或依赖。
- 验证：合并最新集成分支 `5185320f` 后，`bun run check:dev` 通过；view/model-picker、view/i18n、model-switch 共 16 tests 通过（1.45s）；image-model-notice 和 model-switch 共 17 tests 通过（4.52s），覆盖 draft image、40×12、共存面板与阅读位置。最终新增用例均小于一秒，首次应用启动成本约 0.6s；无固定延时同步。
- ADR coverage：沿用 spec 中 ADR-0006 与 ADR-0008，view 负责呈现 policy、Agent Core 负责凭据事实，未改变所有权、存储或终端恢复协议。剩余过滤、Thinking Level 与逐级高度预算由后续票负责；完整 `bun run check` 由集成分支最终验收运行一次。
