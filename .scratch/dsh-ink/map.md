# dsh ink map

## Notes

任务图与范围见 [spec](spec.md)；工单按 02 → 03 → (04, 05) → 06 推进。

## Decisions-so-far

- [01 Bun spike](issues/01-bun-spike.md) resolved：Bun 全屏/输入/注入 xterm 与真实 sixel worker可行，ADR13 accepted；[证据与迁移清单](spike-notes.md)。
- [02 native runtime](issues/02-vendor-runtime.md) 与 [03 design system/editor](issues/03-design-system-editor.md) resolved，固定上游来源并保留Rukie产品层。
- [04 图片](issues/04-image-adoption.md) resolved：六组76/265与额外Logo/Goal协议、共存、窄屏回归通过。
- [05 TUI](issues/05-app-adoption.md#answer) resolved：最新64d16282合入全部产品前沿，旧9失败均公开聚焦通过；nativeAlt退出无React警告。

- [06 交付](issues/06-parity-delivery.md#answer) resolved：原生公开行为迁移、来源审计、双轴审查修复、最终完整 gate 2885/16517 全绿及工作树清理完成。

## Fog

无未完成工单。
