# 21: 终端图形协议（kitty 缩略图与预览）

Type: grilling
Status: resolved
Blocked by: 18

## Question

`@neant/tui` 如何支持 kitty 图形协议，复刻 dsh-TUI 的 transcript 图片缩略图、图片预览浮层与输入框 token 悬停预览卡？

已定前提（见 [图片输入](18-image-input.md)）：只做 kitty，tmux / screen 及不支持的终端退回 `[Image · name]` 占位；不加解码依赖，PNG 以 `f=100` 直传由终端缩放（`c=cols,r=rows`），非 PNG 显示占位；缩略图尺寸照 dsh（单张 ≤ 24×12 cell，多张每张 10 列，按文件头宽高比）。

需定：renderer 新宿主元素（图片保留区、文字 fallback）与 ADR-0005 管线的接合；placement 生命周期（随 diff、虚拟滚动 clip、resize、离屏删除、image id 与去重、LRU）；能力探测（kitty 查询、cell 像素尺寸 `CSI 16t/14t`、DA1 哨兵、输入解析器吞掉回复）；终端恢复（退出 / 崩溃 / 外部编辑器 `deleteAll`，ADR-0006）；是否需新 ADR；预览浮层（Fit / 100% / 缩放 / 平移、多图翻页、标题行 `Image #N — PNG · W×H · size · name`、Open original）与悬停预览卡的交互；小终端行为；测试方式（headless terminal 断言输出序列）。参考 dsh-TUI `ink/kitty-graphics.ts`、`ink/terminal-querier.ts`、`ink/terminal-image.ts`、`ink/components/Image.tsx`、`components/messages/TranscriptImages.tsx`、`ImagePreviewOverlay.tsx`。

## Comments

2026-10-06：消息流部分通过 [消息流图片预览规格](../../image-message-preview/spec.md) 完成并合入 main `9e895a2`。renderer 提供 Image、能力/cell metrics、PNG 上传去重、source-pixel crop、离屏/resize/卸载/异常清理；应用提供 user/read/resume 画廊及消息区预览，只有显式原图入口启动系统查看器。当前契约见 [renderer README](../../../packages/tui/README.md) 和 [Neant TUI README](../../../apps/neant-tui/README.md)。main aggregate 2187 pass / 0 fail；双轴审查和清理见 [验收](../../image-message-preview/review.md)。输入 token 悬停预览卡尚未实施，本票继续 open。

## Answer

2026-10-06。消息流部分已在 main `9e895a2` 落地，见上方 Comments，不重审。本票只剩输入框 `[Image #N]` 预览，照 dsh-TUI 的光标预览（`src/screens/Chat.tsx` caret-driven preview）复刻。原 Question 写的“悬停”不准确：dsh 由光标触发，不由鼠标悬停触发。

1. **触发**：光标停在已绑定 token 的起始位置时显示该图，token 反色；光标离开 token 后卡消失，token 之后那一格不算在 token 上。`TextInput` 需新增光标位置回调，例如 `onCursorChange(offset)`，Chat 用 `composer.ranges()` 判断光标是否命中 token。
2. **焦点**：非模态。键盘留在输入框，←/→ 照常移动光标，卡随光标经过的 token 切换，Enter 照常发送。预览是由光标位置派生出来的状态，不进 `previewRef`，也不走模态预览的按键分支。
3. **点击**：不做。`TextInput` 不加鼠标定位光标的能力。被 Esc 关掉的卡，光标离开再回来即可重新显示。
4. **Esc**：预览显示时 Esc 只关当前这张卡，并消费这次按键，不往下传，原有 Esc 链（中止 run 等）不触发。关闭状态按 token 记住，光标离开该 token 后清除。双击 Esc 回退只在输入框为空时触发，与本功能不冲突。
5. **形态**：复用现有 `ImagePreview` 和现有消息区预览区域，覆盖消息区，不盖住输入框和状态行。标题用 `Image #N`，单图显示，不提供 ←/→ 换图。`ImagePreview` 新增被动模式：不收键盘，不提供打开原图入口。
6. **不显示的情况**：小终端（`columns < 40 || rows < 12`）；有待处理的交互；非 chat 视图；模型或 Session 选择器打开；Rewind 中。以上与 `openImage` 的拦截条件一致。模态预览打开时，以模态预览为准。
7. **测试**：用 headless terminal 断言以下行为：光标进入和离开 token 时卡的显示与消失；多个 token 之间切换；Esc 关闭后光标移开再回来重新显示；预览显示时 Enter 仍正常发送；小终端和有交互时不显示。

范围外：鼠标点击 token、鼠标悬停触发、贴着输入框的小卡、输入框内缩略图。

Spec：[输入框图片光标预览](../../composer-image-peek/spec.md)

## Composer preview delivery

2026-10-07：输入框光标预览已在 `codex/composer-image-peek` 完成；三张实施票均 resolved，集成代码 `3950234`。绑定 token 起始位置触发被动卡与反色；Esc 仅关闭当前卡，离开再回来重新显示；审批/提问、选择器、Rewind、非 chat、MCP、小终端与模态优先处理已覆盖。补齐小终端恢复光标和正常最小尺寸文字占位。`env -u NO_COLOR bun run check`：2512 pass / 0 fail，184 files；Standards / Spec 审查发现已修复并复核，详见 [验收记录](../../composer-image-peek/review.md)。原 Comments 中“尚未实施”的状态已由本次交付更新；2026-10-07 已快进合入 main `585cb2d`。
