Status: resolved

# Spec: 渲染栈改用 dsh-TUI 的 ink

决定见 [ADR-0013](../../docs/adr/0013-adopt-dsh-tui-ink.md)（accepted）。必须在 [package-merge](../package-merge/spec.md) resolved 之后开始。

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

## Delivery

全部六张工单 resolved，最终验收与清理见 [06 交付记录](issues/06-parity-delivery.md#answer)。集成分支为 `codex/dsh-ink`；固定来源、原生 runtime、Rukie 产品接线与文档一致。最终 `env -u NO_COLOR bun run check` 通过：2885 tests、16517 assertions、0 fail。双轴审查问题已修复，本任务的实现工作树与已合入辅助分支已清理。

## ADR Coverage

| 决定或修改                                        | 归属                                                                                                                                  | 理由                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 固定来源采用 dsh ink/Yoga、保留本地差异和来源风险 | 更新 [ADR-0013](../../docs/adr/0013-adopt-dsh-tui-ink.md)，替代 [ADR-0005](../../docs/adr/0005-own-tui-renderer.md)                   | 原生渲染管线替换自研实现；原始 SHA 与局部补丁分开维护，accepted 与 superseded 关系明确                     |
| 全屏、阅读位置、bottom-follow、选字与退出恢复     | 沿用 [ADR-0006](../../docs/adr/0006-fullscreen-tui.md)                                                                                | 原语替换不改变产品交互义务；注入终端、多根与真实进程覆盖生命周期                                           |
| Headless/TUI/ink/view 依赖方向                    | 更新并沿用 [ADR-0012](../../docs/adr/0012-single-coding-agent-package.md)                                                             | Headless 仍动态加载，ink 豁免不解除目录边界，增加 AST 导入检查                                             |
| 图片持久化与终端资源、Frontend 本地化             | 沿用 [ADR-0021](../../docs/adr/0021-native-image-input-persistence.md)、[ADR-0008](../../docs/adr/0008-locale-agnostic-agent-core.md) | Session 原生图片与恢复语义不变；Frontend 解码、交互、释放 RGBA 与复制传输，Agent Core 保持 locale-agnostic |
| 主分支输入选择/caret、Run 统计与文档工具整合      | 无需新 ADR                                                                                                                            | 将已有公开行为接到已接受的原生路径；不引入新的持久化、权限或模块所有权决定                                 |

主分支整合复核已核对来源、边界、资源归属及替代关系；采用 ADR-0013 accepted，不恢复 ADR-0005 或旧 renderer facade。ADR 的 YAML 格式与索引遵循主分支的文档工具，未提交的 pi-durable 决定属于并行工作。
