Status: claimed
Blocked by: 01

# 03: Kitty placement 与终端生命周期

完成 [spec](../spec.md) 中 renderer 生命周期责任。仅 fullscreen 与 Kitty 支持、tmux/screen 禁用；PNG 分块上传、图片上传去重、有界资源、placement 随布局/滚动 clip/resize 更新，离屏及终端清理删除。区域裁剪支持预览缩放和平移。探测回应、pixel cell 回应及 DA 哨兵不得污染输入，分块和晚到回应均验证。支持 held-primary motion，用 generic move.button 暴露拖动。inline 不输出图形。支持最大已准入 PNG 或有可观察降级。通过公共 render 终端测试验证协议与成功、错误、resize、离屏、卸载清理；同步 renderer README。

## Comments

2026-10-06：01 基线 27262b3 已在集成提交 5bf5111 验证。renderer implementer 继续拥有 packages/tui，02 独立拥有 apps/neant-tui；依赖接口保持一致。公开 seam 为 render/useInput + injected terminal。
