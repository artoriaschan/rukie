Status: ready-for-agent
Blocked by: none

# 01: Kitty 图形渲染能力

实现 [spec](../spec.md) 中 renderer 责任。提供通用 Image 原语与能力/cell 像素尺寸 hook，公开 API 先与集成 agent 同步。不依赖 Agent Core。探测回复支持分块并在输入解析前吞掉；tmux/screen 禁用。PNG chunked transmission、图片上传去重、有界内存、placement 随布局/滚动 clip/resize 更新，离屏及终端清理删除。区域裁剪支持预览缩放和平移。仅 fullscreen 图形输出；inline 保留降级。通过公共 render 终端测试验证协议与生命周期。同步 renderer README，必要时记录与 ADR 的接合。

## Comments

2026-10-06：用户请求消息流图片 UI，既定公开 seam 为 render + 注入 terminal，参照根 AGENTS.md；集成基线 main 85d0dfa。
