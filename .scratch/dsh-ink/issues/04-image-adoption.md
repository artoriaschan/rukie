# 04: 迁移图片为 bounded RGBA 与 Kitty/sixel

Status: ready-for-agent
Blocked by: 03
Type: task

见 [spec](../spec.md) 与 [spike evidence](../spike-notes.md)。

应用拥有原图解码、裁切、缩放；renderer 接收不可变、有限 RGBA。范围是图片 decode/gallery/preview 与其 tests，不并行编辑 05 所拥有的 Chat 屏幕；最终接线协调经明确 exports。

- [ ] PNG base64/original payload 在应用层解码为 dsh TerminalImageSource；保留完整原图以供原像素检查，transcript <=1024 edge/4MiB、preview <=2048 edge/8MiB
- [ ] gallery 与预览使用新 Image/source/presentation/hooks；源像素 pan/crop 在应用层生成新的 immutable buffers，保留中心、缩放、drag、padding/resize/clipping 行为
- [ ] 正确触发 demand probe，Kitty 与 sixel 均传递 protocol-specific presentation；无图形支持时保留 fallback copy
- [ ] 改接 drag/wheel/cell metrics 新事件结构，移除旧 useTerminalGraphics、mime/base64/crop renderer contract 的消费者
- [ ] 公开应用场景验证 8000x8000 admitted source 的缩图、bounded preview、透明/裁切/遮挡、资源释放；真实 worker 与 sharp 六色协议路径验证通过
- [ ] 更新图片 owning docs 与测试，不创建旧图片 API facade
