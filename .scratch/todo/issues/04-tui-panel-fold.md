# 04: 待办面板折叠交互

**What to build:** TUI 用户可用 `ctrl+q` 或鼠标点击折叠头折叠 / 展开待办面板；折叠后仍能看到当前在做的那一项。

**Blocked by:** 03（TUI 待办面板）

**Status:** done

参考：[spec](../spec.md)「TUI」；dsh-TUI `GoalTodoPanel.tsx` 折叠部分与 `keymap.ts`（`todoFold`）。

- [x] `ctrl+q` 切换折叠，运行中也有效；不与现有快捷键冲突
- [x] 折叠头可点击切换，悬停换背景（复用 renderer hover 能力）
- [x] 折叠时只剩头部 `▸ ✓ done/total` + 一项预览（优先 in_progress，否则首个未完成）
- [x] 展开时底部显示"Ctrl+Q 折叠"提示（i18n）
- [x] 折叠状态为屏幕本地状态，默认展开，不持久化

测试（seam 2）：

- [x] `ctrl+q` 折叠 / 展开与折叠预览
- [x] 鼠标点击折叠头切换
- [x] 展开提示中英文案

## Comments

2026-10-04：使用 `/Users/artorias_chan/.agents/skills/implement/SKILL.md`，按 `tdd` 已约定 seam 2（公共 `start` + faux 模型 + 终端屏幕/cells）完成。Ctrl+Q、hover/mouse 与中英文 hint 均先红后绿；仅实施 04，05 transcript 工具卡由后续工单负责。

实现证据：

- chat screen 持有 `todosCollapsed` 屏幕本地状态，初值 false；Ctrl+Q 在运行中与空闲都切换，不中断 Run、不改动草稿，也不持久化。面板经 `collapsed` / `onToggle` props 接入；第二个 `start --resume` 恢复同一 Session 时，无模型调用即回到展开态。
- 复用 renderer 的 SGR 点击与 hover 能力，头部移入换 `badgeHoverBackground`，移出恢复；点击同一头可折叠/展开。
- 折叠呈现 `▸ ✓ done/total` 全量计数头及一行树形预览：优先首个 in_progress，否则首个未完成；只剩已完成项的运行态没有预览。按 spec 保留头+预览两行结构，未加入 Goal。
- 展开底部提示由双语字典给出 `Ctrl+Q 折叠` / `Ctrl+Q fold`。沿用 03 的 maxHeight 与 compactReturn 预算；空间足够时提示独占底行，40×12 + PageUp 只有两行预算时与 overflow 共底行，同时保留全量计数、overflow 数量、输入与 status。仅一行预算时提示附在头上，折叠时不显示提示。
- 已对照实际 dsh-TUI `GoalTodoPanel.tsx` 的折叠/hover 与 `keymap.ts` 的 todoFold 默认 Ctrl+Q；保留面板来源/MIT 许可。

验证证据：

- 第一片 Ctrl+Q 红测正确失败于未出现 `▸` 头；实现后通过，8 assertions，验证运行中持续执行与 idle draft 不受影响。
- 第二片鼠标 hover 红测正确失败于背景未变；实现后通过，验证 hover 进出、点击折叠/展开与首个 pending 预览。
- 第三片中英文 hint 与短屏红测正确失败于提示缺失；预算内实现后通过。
- 最终聚焦 todo-panel / fullscreen / permissions / questions / resume：74 pass / 0 fail，393 assertions，5 files，11.86 秒。
- `rtk proxy bunx tsc -b`：两轮均通过。
- `rtk proxy env -u NO_COLOR caffeinate -is bun run check`：format / lint / tsc / Knip / 完整测试全部通过，709 pass / 0 fail，4397 assertions，59 files，100.21 秒。
- 独立 Spec 审查复跑 todo-panel：10 pass / 0 fail，55 assertions。

## Standards

固定审查基点 `f71f1200cde61b2f07b2ee85ff2b6f2930fcf638`；独立 Standards 子代理审查四文件 diff：0 项发现，无文档标准违规或需报告 Fowler 异味。screen 状态经 props/回调传入、组件 hover 沿既有呈现模式、frontend 双语字典、Bun 公共黑盒测试与固定底部预算均符合文档要求。

## Spec

独立 Spec 子代理：0 项发现。Ctrl+Q（含运行中）、点击/hover、预览优先级、中英提示、默认展开与不持久化均满足 04/spec；无超范围行为。独立公共测试覆盖同 Session 二次 resume，以及 40×12 + PageUp 同时保留计数、overflow、hint、输入/status。

审查合计：Standards 0 未解决，Spec 0 未解决。

提交：`4891ad46217d7e9be7b2c17b540c057abbd5947c`（`feat(tui): fold todo panel with keyboard and mouse`），已提交当前 main。本地 Markdown tracker 已勾选验收项并设置 done，验收、测试与审查证据随工单提交。
