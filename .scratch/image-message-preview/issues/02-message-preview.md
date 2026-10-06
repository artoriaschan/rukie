Status: resolved
Blocked by: 01

# 02: 消息流画廊与预览浮层

实现 [spec](../spec.md) 中所有应用行为，参考 dsh-TUI 证据。利用 01 通用图形 API，user/read/resume 相同显示路径；保留 unsupported/non-PNG 文字降级，点击仍打开预览浮层。元数据、Fit/100%/缩放/平移/多图切换/原图入口及关闭路径，键鼠输入隔离、草稿与阅读位置、小终端/resize、运行中与 Interaction 共存、本地化全部验证。更新现有外部 viewer 测试为显式“打开原图”动作。不复制参考 renderer，不引入解码依赖。同步拥有行为的运行文档。

## Comments

2026-10-06：公开 seam 为 TUI start + injected headless terminal/host，根 AGENTS.md 已约定。依赖 renderer 01，参考探索笔记 /tmp/neant-image-message-reference.md。

## Implementation and verification

2026-10-06：独立实现消息画廊及消息区预览，参考 dsh-TUI HEAD `646740f12c34546d6c195f5b7031be0dc67421a5` 的 `src/components/messages/TranscriptImages.tsx`、`src/components/ImagePreviewOverlay.tsx` 和 `src/screens/Chat.tsx`；没有复制参考 renderer 或引入解码依赖。用户、read、恢复共用画廊，打开时保留全部出现次数的快照；缩略图暂停 placement 并保留格子，PNG 使用通用 Image 原像素 crop，Fit、100%、1/2/4/8×、按钮/滚轮/拖动平移、边界导航及显式原图入口。圆角、下划线经 renderer 公开 API 呈现；不支持图形、非 PNG、缺少 cell metrics 及小终端保留 metadata 和原图入口。所有预览输入通过现有 handledInput 加立即 ref guard 隔离，关闭按键不提交/编辑草稿或中断 Run；Interaction、Session 替换和 conversation_rewound 关闭预览。

公开 seam 为 `start` + injected headless terminal/host。先运行新 metadata/closing-Enter 场景，旧实现因点击直接打开 host 而失败；实现后通过。最终 focused `env -u NO_COLOR bun test apps/neant-tui/tests/e2e/image-preview.test.ts apps/neant-tui/tests/e2e/images.test.ts apps/neant-tui/tests/components/user-message/user-message.test.tsx`：45 pass、0 fail、197 assertions。包含有效 CRC/zlib 的 1000×800 PNG fixture，通过终端 IO 验证等比例缩略图、原像素 crop、Fit/100%/200%、wheel/drag/button 平移、upload 去重及 metrics 前禁用状态；验证重复 user/read 出现次数、后台新增图片不改变画廊、approval/question 接管、四种关闭路径、真正阅读状态下的后台 streaming/return 控件隔离、zh/en GIF 降级、30×10 resize、恢复和私有原图导出生命周期。既有 fullscreen/question-panel-parity/streaming-burst：53 pass、0 fail、374 assertions。旧直接打开外部 viewer 测试改为点击卡片显式“打开原图”，继续验证精确字节、私有权限、pending exit 及错误。

拥有行为的使用说明在 `apps/neant-tui/README.md`；`docs/architecture.md` 同步应用/renderer/host 责任并链接公开协议说明。oxfmt、oxlint、`tsc -b`、Knip 和 diff whitespace 检查通过；整合分支最终 aggregate、Standards/Spec review 由整合步骤记录。
