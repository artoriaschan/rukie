---
status: accepted
---

# 图片输入保存原生内容块，Frontend 管理附件交互与终端资源

## 问题

图片来自用户输入或文件读取，必须在 Headless、TUI、Resume 和模型切换之间保留。仅保存临时文件路径会让会话依赖 Frontend 清理后可能消失的资源。

## 决定

Agent Core 对 run、steer 与 read 的图片共用内容校验，依据实际字节识别格式并检查尺寸。校验后的图片以原生 inline image blocks 保存到 Transcript，包含 base64 内容；附件名称仅作为 Frontend metadata，在模型边界剥离。

模型是否支持图片输入由模型定义决定。文本模型使用占位说明适配输入，历史图片仍保留，之后切换视觉模型可以再次使用。prompt hook 改写文本时保留原图片内容，不将图片隐式转换为文件路径或自然语言。

Frontend 负责剪贴板、临时文件、附件展示和清理；终端 renderer 负责图形协议、placement 与资源释放。Core 不参与图片预览、缩放或终端布局。本轮不建立外置附件存储，也不引入自动缩放解码管线。

依据：[图片输入规格](../../.scratch/image-input/spec.md)。后续[消息图片预览](../../.scratch/image-message-preview/spec.md)与[输入图片查看](../../.scratch/composer-image-peek/spec.md)在上述 Frontend 与 renderer 边界内扩展。

## 备选方案

- Transcript 只保存临时文件路径：恢复依赖原 Frontend 的文件寿命，跨机器或清理后内容可能缺失。
- 本轮建立独立 attachment store 或自动缩放：规格明确排除，先采用自包含的原生消息块。

## 影响

Session 文件会包含图片原始内容并增加体积，凭据与隐私保护也要覆盖会话存储。Frontend 必须单独管理展示资源；模型切换应转换输入表示，同时保留原 Transcript。
