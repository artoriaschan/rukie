# 02: 渲染器补齐样式能力

**What to build:** `@neant/tui` 的 ① 层补上样式所需的能力：`Text` 支持 `inverse` 和 `italic`；设置 `NO_COLOR`（非空）时不输出任何颜色转义，但粗体等非颜色样式照常；`Spinner` 可传入自定义帧，不传时仍为现有 braille 帧。见 spec 的 ① 节。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `inverse`、`italic` 输出对应 SGR，帧差分在只改这两种样式时也会重写该 cell
- [ ] `NO_COLOR` 下 hex 与 ANSI 名颜色都不产生颜色 SGR，`bold` 仍生效
- [ ] `Spinner` 传帧时按给定帧循环，不传时行为不变
- [ ] 以上每项有 `bun:test` 单元测试（headless 终端读回 cell）
- [ ] `bun run check` 全绿
