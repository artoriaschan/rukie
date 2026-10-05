# 21: 终端图形协议（kitty 缩略图与预览）

Type: grilling
Status: open
Blocked by: 18

## Question

`@neant/tui` 如何支持 kitty 图形协议，复刻 dsh-TUI 的 transcript 图片缩略图、图片预览浮层与输入框 token 悬停预览卡？

已定前提（见 [图片输入](18-image-input.md)）：只做 kitty，tmux / screen 及不支持的终端退回 `[Image · name]` 占位；不加解码依赖，PNG 以 `f=100` 直传由终端缩放（`c=cols,r=rows`），非 PNG 显示占位；缩略图尺寸照 dsh（单张 ≤ 24×12 cell，多张每张 10 列，按文件头宽高比）。

需定：renderer 新宿主元素（图片保留区、文字 fallback）与 ADR-0005 管线的接合；placement 生命周期（随 diff、虚拟滚动 clip、resize、离屏删除、image id 与去重、LRU）；能力探测（kitty 查询、cell 像素尺寸 `CSI 16t/14t`、DA1 哨兵、输入解析器吞掉回复）；终端恢复（退出 / 崩溃 / 外部编辑器 `deleteAll`，ADR-0006）；是否需新 ADR；预览浮层（Fit / 100% / 缩放 / 平移、多图翻页、标题行 `Image #N — PNG · W×H · size · name`、Open original）与悬停预览卡的交互；小终端行为；测试方式（headless terminal 断言输出序列）。参考 dsh-TUI `ink/kitty-graphics.ts`、`ink/terminal-querier.ts`、`ink/terminal-image.ts`、`ink/components/Image.tsx`、`components/messages/TranscriptImages.tsx`、`ImagePreviewOverlay.tsx`。
