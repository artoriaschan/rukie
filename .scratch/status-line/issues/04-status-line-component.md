# 04: StatusLine 三行组件

Status: ready-for-agent

**What to build:** 见 spec 中 ③ `StatusLine` 一节。只接收 props，组件内部只有 hover 状态。

- 分段条：用最大余数法分配列宽，非零段至少占 1 列；读数三档降级；80% 和 95% 时变色；宽度小于 14 时隐藏，但保留该行高度。
- 字段行使用紧凑模式，字段依次为 model、tps、effort、缓存、in→out、git、cwd basename，ctx 固定在右侧。
- tps 有三种显示：仪表、sparkline、无样本；按三档速度着色。
- hover：ctx 原位变成迷你仪表，第三行显示各字段明细（文案照 spec）。
- 第三行按优先级显示：hover 明细、滚动提示、`esc 中断`、空。三行高度始终固定。

**Blocked by:** 01, 02

- [ ] 组件冒烟测试：列分配、读数降级、宽度小于 14 时隐藏、80% 和 95% 的颜色
- [ ] 组件冒烟测试：tps 三种形态和三档颜色；缺少某个字段时，不显示该字段，也不留多余的分隔符
- [ ] 组件冒烟测试：用 motion 悬停 ctx、bar、cache 时显示对应明细，移开后恢复，高度不变
- [ ] 在 80、60、40 列下各字段独立截断，ctx 不收缩
- [ ] `bun run check` 全绿
