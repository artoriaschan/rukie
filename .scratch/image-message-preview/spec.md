Status: claimed

# Spec: 消息流图片预览

用户要求：图片输入已配置，消息流缺少图片预览 UI 及交互；参考 dsh-TUI 复刻。此需求扩展已交付的 [图片输入](../image-input/spec.md)，实现 [终端图形协议](../agent-core-roadmap/issues/21-terminal-graphics.md) 的消息流部分。输入框 token 悬停卡另行实施。

## 行为

- 用户消息、工具读图及恢复的 Transcript 都显示图片画廊。支持 Kitty 的终端中，PNG 显示等比例缩略图：单张最多 24×12 cell，多张每张 10×5，随可用宽度排列。无图形能力、tmux/screen、非 PNG 保留文字降级。
- 点击任意缩略图或文字降级打开消息区内的图片预览浮层；页头、输入及状态栏保留。打开时快照当前 Transcript 全部图片，保留重复出现的图片并定位点击的那一次；后台新消息不改变打开的画廊。浮层拥有键盘与鼠标输入，草稿及消息阅读位置保留，后台 Run 继续；新 Session、恢复/rewind 与审批/提问接管焦点时关闭。
- 标题显示 Image #N、格式、像素尺寸、文件大小、名称。Fit、100%、+/-（1×/2×/4×/8×）、四向平移、拖动与滚轮平移、多图上/下一张、显式打开原图，行为参考 dsh-TUI。
- Esc、Ctrl+C、Enter、点击浮层外关闭；左右键切换图片并在边界停止。只有“打开原图”通过现有私有导出和注入 host 打开系统查看器。无图形能力仍可看元数据并操作原图入口。
- 小于 40×12 时不画图；resize 后布局及阅读位置稳定。zh/en 同步。名称等显示数据不能注入终端控制序列。
- 不引入解码依赖；仅 PNG 使用 Kitty f=100 直传、终端缩放与原像素区域裁剪。renderer 负责探测、回复消耗、图片上传去重、裁剪、位置、离屏/resize/卸载/异常删除及终端恢复；应用组件不输出 ANSI。
- 缩略图在预览开启时保留几何并暂停图形 placement，避免盖住浮层。缺少 cell 像素尺寸或没有图形能力时禁用 100%/缩放/平移；Fit 仍可用。终端决定缩放过滤器，不承诺 dsh 的 nearest-neighbor 解码过滤器。
- 不修改 Session、模型调用、存储格式、图片准入与输入 token 行为。按当前架构独立实现，不复制 dsh renderer。

## 工单与验证

01 renderer 公开接口与 PNG 渲染基线 → 02 画廊与预览交互、03 renderer 生命周期（共享基线验证后独立实现）。以仓库既定公开 seam 验证：`@neant/tui` render + 注入终端，TUI start + headless terminal + 注入 host。逐片 red→green，覆盖分块探测回复不进入草稿、缩略图、滚动裁剪/离屏删除、去重、resize/关闭/异常恢复、无图形降级、画廊、预览模式与平移、输入隔离、阅读位置、resume/read 与原图导出。最终 Standards/Spec 双轴审查及 `env -u NO_COLOR bun run check`。

## 参考

dsh-TUI `src/components/messages/TranscriptImages.tsx`、`src/components/ImagePreviewOverlay.tsx`、`src/ink/kitty-graphics.ts`、`src/ink/terminal-querier.ts`、`src/ink/terminal-image.ts`。探索证据保存在 `/tmp/neant-image-message-reference.md`，实施票记录可复查源码指针。
