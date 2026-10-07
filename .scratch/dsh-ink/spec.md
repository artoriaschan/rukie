Status: claimed

# Spec: 渲染栈改用 dsh-TUI 的 ink

决定见 [ADR-0013](../../docs/adr/0013-adopt-dsh-tui-ink.md)（proposed）。必须在 [package-merge](../package-merge/spec.md) resolved 之后开始。

## Problem Statement

全屏选字与复制（ADR-0006）、hit-test、按键解析、kitty/sixel 图形等行为，目前要对照 dsh-TUI 在自研渲染器上逐项补齐。dsh-TUI `3c89ea51` 的 `src/ink/` 已有现成实现，用户接受它的来源与许可风险。

## Solution

先做 spike，验证 dsh ink 能在 Bun 下运行，并能注入 xterm headless 终端做测试。spike 通过后，把 `packages/coding-agent/src/ink/` 的内容整体替换为 dsh ink。实施工单在 spike 之后拆分。

## Implementation Decisions

- 来源：dsh-TUI `3c89ea51` 的 `src/ink/` 与 `src/native-ts/yoga-layout`，原样搬入，升级时按上游 diff 重新搬入。
- dsh-TUI 内部依赖（`utils/*`、`bootstrap/state`、`handoffAck`、`dsh-adapter/sharp`）用最小桩替代，每处改动记在 `ink/README.md`。
- `ink/` 整体豁免 Oxlint 与 Knip。ADR-0012 的目录边界照旧生效：`ink/` 不依赖上层目录，`tui/` 只经 `ink/index.ts` 使用 `ink/`。
- 约 30 个新 npm 依赖按精确版本固定，登记在 `docs/tech-stack.md`。
- 保留 Rukie 的 design-system，改接 dsh ink 的原语；不引入 dsh 的 theme、themePrefs、ui。
- 应用层改用 dsh ink 的 `Box`、`Text`、`ScrollBox`、`useInput`、`Image` 等的 props 与语义。ADR-0006 要求的终端恢复、阅读位置、bottom-follow 与小终端处理需要重新验证。

## Out of Scope

- dsh-TUI 的 `components/`、`screens/`、主题与偏好体系。
