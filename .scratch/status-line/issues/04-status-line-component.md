# 04: StatusLine 三行组件

Status: resolved

**What to build:** 见 spec 中 ③ `StatusLine` 一节。只接收 props，组件内部只有 hover 状态。

- 分段条：用最大余数法分配列宽，非零段至少占 1 列；读数三档降级；80% 和 95% 时变色；宽度小于 14 时隐藏，但保留该行高度。
- 字段行使用紧凑模式，字段依次为 model、tps、effort、缓存、in→out、git、cwd basename，ctx 固定在右侧。
- tps 有三种显示：仪表、sparkline、无样本；按三档速度着色。
- hover：ctx 原位变成迷你仪表，第三行显示各字段明细（文案照 spec）。
- 第三行按优先级显示：hover 明细、滚动提示、`esc 中断`、空。三行高度始终固定。

**Blocked by:** 01, 02

- [x] 组件冒烟测试：列分配、读数降级、宽度小于 14 时隐藏、80% 和 95% 的颜色
- [x] 组件冒烟测试：tps 三种形态和三档颜色；缺少某个字段时，不显示该字段，也不留多余的分隔符
- [x] 组件冒烟测试：用 motion 悬停 ctx、bar、cache 时显示对应明细，移开后恢复，高度不变
- [x] 在 80、60、40 列下各字段独立截断，ctx 不收缩
- [x] `bun run check` 全绿

## Answer

实现只接收 props 的 `StatusLine`，内部只有 hover 状态。公开 `StatusLineProps` 和 `TpsSample`，样本使用 `{ at, value }`，`now` 由 frontend 传入，用于最近 60 秒平均值；`contextUsage` 可缺省以适配首次事件到达前的状态。

三行和左右各一列 padding 固定。分段条根据 provider used/window 计算已用与空闲预算，再按估算分段占比分配；约束最大余数法保留非零段至少一列。空闲段内读数按完整、百分比、隐藏降级，并使用主题背景和压力色。字段独立按列预算截断，ctx 固定右侧；tps 支持 11 格轨道、1/8 块、最近 12 个样本 sparkline 和无样本读数。hover 明细覆盖各字段，ctx 原位切换同宽仪表，移开后按滚动提示、工作中断、空的顺序恢复。

chat 当前的单行 footer 保留原样，05 号票据负责接入新 props、会话指标、滚动提示和活动行压力前缀。本次独立实现，未复制 dsh-TUI 代码。

验证：

- `rtk proxy env -u NO_COLOR bun test apps/neant-tui/tests/components/status-line/status-line.test.tsx`：28 pass，覆盖字符、背景/前景色、motion、三行高度以及 80/60/40 列。
- `rtk proxy env -u NO_COLOR bun test packages/tui/tests`：75 pass。
- `rtk proxy env -u NO_COLOR bun run check`：格式、lint、类型检查、Knip 通过，全量 348 tests 通过。测试清除环境默认的 `NO_COLOR=1`，验证实际主题颜色。

审查：Standards 发现 tps 测量和渲染文案重复，已合并为共享的彩色文本片段，复审剩余 0 项；Spec 0 项。
