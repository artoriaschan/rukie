Status: open
Blocked by: 01

# 02: 消息流画廊与预览浮层

实现 [spec](../spec.md) 中所有应用行为，参考 dsh-TUI 证据。利用 01 通用图形 API，user/read/resume 相同显示路径；保留 unsupported/non-PNG 文字降级，点击仍打开预览浮层。元数据、Fit/100%/缩放/平移/多图切换/原图入口及关闭路径，键鼠输入隔离、草稿与阅读位置、小终端/resize、运行中与 Interaction 共存、本地化全部验证。更新现有外部 viewer 测试为显式“打开原图”动作。不复制参考 renderer，不引入解码依赖。同步拥有行为的运行文档。

## Comments

2026-10-06：公开 seam 为 TUI start + injected headless terminal/host，根 AGENTS.md 已约定。依赖 renderer 01，参考探索笔记 /tmp/neant-image-message-reference.md。
