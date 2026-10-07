# dsh ink map

## Notes

任务图与范围见 [spec](spec.md)；工单按 02 → 03 → (04, 05) → 06 推进。

## Decisions-so-far

- [01 Bun spike](issues/01-bun-spike.md) resolved：Bun 全屏/输入/注入 xterm 与真实 sixel worker 可行，ADR13 accepted；[证据与迁移清单](spike-notes.md)。生产仍须修复 stream context 与退出已完成状态。

## Fog

- 生产 reading anchor、clipboard outcomes、全屏 selection 和图形 clipping 的最终行为以 04/05/06 的公共终端验收为准。

- 04 图片产品回归完成：六组76/265通过，PNG像素协议场景已原生迁移；见 [04 verification](issues/04-image-adoption.md#final-public-verification)。
