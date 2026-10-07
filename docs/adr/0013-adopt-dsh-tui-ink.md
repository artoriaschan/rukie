Status: accepted

# 终端渲染栈改用 dsh-TUI 的 ink

`packages/coding-agent/src/ink/` 采用 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 的 `src/ink/` 与 `src/native-ts/yoga-layout`，取代 ADR-0005 的自研渲染管线。动机是直接获得全屏选字与复制（ADR-0006）、hit-test、按键解析、kitty 与 sixel 图形等已有实现，不再逐项对照 dsh-TUI 重写。

这份 ink 约 3.3 万行，源自 Claude Code 内部的 Ink fork：保留 Ink 的报错文案与 `TODO(vadimdemedes)`，同时依赖 Claude Code 的内部工具与 custom lint 规则，`THIRD_PARTY_LICENSES` 中没有对应条目。用户明确接受来源与许可风险。

采用方式：

- 原样搬入，固定来源 commit；升级时按上游 diff 重新搬入。
- dsh-TUI 内部依赖（`utils/*`、`bootstrap/state`、`handoffAck`、`dsh-adapter/sharp`）以最小桩替代，改动逐项记录在 `ink/README.md`。
- `ink/` 整体豁免 Oxlint 与 Knip，与此前 vendored Yoga 的处理一致。
- 新增的约 30 个 npm 依赖按精确版本固定，登记在 `docs/tech-stack.md`。
- 保留 Rukie 的 design-system，改接 dsh ink 的原语；不引入 dsh-TUI 的主题与偏好体系。

2026-10-07 的 [spike](../../.scratch/dsh-ink/spike-notes.md) 在 Bun 1.4.2 下验证了注入 xterm headless 的全屏原语、键盘输入、退出完成、默认 process 流，以及真实 sixel worker 和 sharp 缩放。本决定据此 accepted，并替代 [ADR-0005](0005-own-tui-renderer.md) 的渲染管线与代码复用边界；应用消费者通过原生公开组件、hooks 与 immutable RGBA 输入使用该 runtime；产品输入编辑与读取位置策略由 Rukie 组合层保留。

## Considered Options

- 维持 ADR-0005，按需对照 dsh-TUI 在自研渲染器上补齐行为：依赖少、来源清楚，但 selection、keypress 等能力需要逐项重写。
- 搬入后改写为 Rukie 代码规范：33k 行的改写成本高，之后无法再与上游同步。
