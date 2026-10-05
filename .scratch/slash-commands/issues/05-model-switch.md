# 05: `/model` 切换

**What to build:** 用户在 TUI 输入 `/model` 打开模型选择器，或 `/model provider/id` 直接切换；从下一次模型调用起使用新模型，resume 后保持，不改 `settings.json`。见 [spec](../spec.md) 的“模型切换”。

**Blocked by:** 01（命令框架与补全菜单）

**Status:** resolved

- [x] Agent Core 导出可用模型清单：settings 自定义模型 + 内置 provider 模型
- [x] Session 新增 `setModel(spec)`：仅空闲；经现有模型解析，失败抛错且当前模型不变
- [x] 选择以 Tool State `model` 持久化，resume 时优先于 settings 的 `model`；不写 `settings.json`
- [x] 沿用父模型的子代理自下一个新建者起使用新模型，已在跑的不变
- [x] TUI：无参数打开选择器（复用现有选择组件，当前模型标注），有参数直接切换；状态栏同步；run 中被拒；错误以通知显示
- [x] Agent Core e2e（下一次调用模型、resume 恢复、错误名、子代理）与 TUI 测试覆盖以上行为

## Answer

已交付 Session `model` / `setModel(spec)` 与 `listModels(settings)`。模型选择通过既有 registry 解析和鉴权，成功后作为 Tool State `model` 持久化；下一次主调用与之后新建的继承子代理使用选择模型，已创建的子代理保持自己的模型。busy、无效名称和缺少凭据均不会改变当前选择；不写 settings 文件。

恢复在读取 Tool State 后解析模型，因此保存的选择优先于 settings.model，即使该 settings 值已无效也可恢复。模型状态变化通过 `tool_state_changed` 通知 frontend；TUI `/model provider/id` 直接切换，`/model` 打开复用 ListItem 的有界焦点窗口选择器，当前项带 ✓，支持上下循环、Enter、Esc 和点击，40×12 可用。状态栏和启动标题立即同步，恢复后无需发 prompt 即显示持久化模型。

验证：公开 createSession/Session 与 TUI start 边界新增 7 tests / 0 failures / 26 assertions；含切换下一次请求、失效 settings 的 resume、无效/缺凭据/忙碌、settings 原文不变、既有与新子代理模型、直接命令、窄终端 picker、恢复初始状态。相关 main、slash、question parity、子代理与 fork/type 回归合计 132 tests / 0 failures / 745 assertions；另 settings + 新测试 44 tests / 0 failures / 73 assertions。oxfmt --check、oxlint、tsc -b、knip 与 git diff --check 通过。

后续整合注意：02 的 compacting 与本票 changingModel 需要互斥；03 标题辅助调用须由测试辅助请求分流包在模型请求计数器外层。完整 spec 的精确整合 HEAD full check 由最终交付执行。

最终 review 纠正：`setModel()` 的空闲互斥错误返回 shared `model-switch-busy`，通用中英字典负责显示；压缩、切换、回退和 active Run 守卫也使用结构化错误码。Core 公开测试验证 pending compaction 拒绝切换时的错误码和参数，原模型与互斥行为保留。

Review fixes validation: 109 pass / 0 fail / 776 assertions across 10 affected public Core, TUI and i18n suites; oxfmt, oxlint, tsc -b, knip and git diff --check passed. Full final integration check remains owned by root.
