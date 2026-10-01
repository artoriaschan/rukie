# 04: Inline scrollback：Static、帧节流、Spinner

**What to build:** 默认 inline 模式能用于长对话：已经完成的内容通过 `Static` 一次性写在活动区上方并推进终端的 scrollback，之后不再重画；活动区保持在底部。快速更新被合并成每 16ms 最多一帧。提供 `Spinner`。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `Static` 新增的子项按顺序出现在活动区上方，在假终端的 scrollback 里每条只出现一次，后续帧不会重复写出
- [ ] 活动区高度超过屏幕时只画最底下的部分，不会把重复内容挤进 scrollback
- [ ] 同一个 16ms 窗口内的多次 state 更新只产生一次写出
- [ ] `Spinner` 会动，unmount 后定时器被清理
- [ ] `bun run check` 全绿
