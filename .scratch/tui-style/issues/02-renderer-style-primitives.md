# 02: 渲染器补齐样式能力

**What to build:** `@neant/tui` 的 ① 层补上样式所需的能力：`Text` 支持 `inverse` 和 `italic`；设置 `NO_COLOR`（非空）时不输出任何颜色转义，但粗体等非颜色样式照常；`Spinner` 可传入自定义帧，不传时仍为现有 braille 帧。见 spec 的 ① 节。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `inverse`、`italic` 输出对应 SGR，帧差分在只改这两种样式时也会重写该 cell
- [x] `NO_COLOR` 下 hex 与 ANSI 名颜色都不产生颜色 SGR，`bold` 仍生效
- [x] `Spinner` 传帧时按给定帧循环，不传时行为不变
- [x] 以上每项有 `bun:test` 单元测试（headless 终端读回 cell）
- [x] `bun run check` 全绿

## Comments

- 2026-10-02：`TextStyle` 新增 inverse / italic，贯通嵌套文本继承、SGR 7 / 3 和 cell 差分。非空 `NO_COLOR` 在 SGR 输出处禁用 hex 与 ANSI 名颜色，保留 bold、dim、inverse、italic；空字符串与未设置时仍输出颜色。
- `Spinner` 新增 `frames?: string[]`，导出 `SpinnerProps`，按传入帧循环；默认 braille 帧和 80ms 间隔不变。
- 按既定 `render` + headless 终端接缝完成红绿测试，覆盖样式开关、嵌套与换行、宽字符差分、NO_COLOR 三种状态，以及自定义 Spinner 帧的完整循环。类型检查在各项实现后通过。
- 最终执行 `rtk proxy env NO_COLOR= bun run check`，格式、lint、`tsc -b`、Knip 和全仓库测试全绿：233 tests / 1251 assertions，0 failures。执行环境自带 `NO_COLOR=1`，常规颜色测试显式清空该变量；专项测试独立设置并恢复它。
- code-review：以实施前 HEAD `d37fbc9e3ce7bb2f12ebf12dedaa97b6e9d0c6bc` 为基线，Standards 与 Spec 两路独立审查均无发现。
