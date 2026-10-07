# 06: 图片可显示时隐藏降级文案

Status: resolved
Blocked by: 05

## Request

用户在 Ghostty + PNG 预览中已能看到图片，但仍显示“终端无法预览此图片”。

## Acceptance

- [x] 可绘制图片与降级文案互斥，包括透明 PNG。
- [x] 不支持图形、非 PNG 与尺寸不足时保留降级占位。
- [x] 复用消息流与 composer 的同一 ImagePreview，公开回归与最终检查通过。

## Verification

现有 app e2e 在成功探测 Kitty 并确认上传/placement 后断言没有降级文案，修改前失败（228.31ms）。修正 ImagePreview 的无条件文案，统一可绘制图片条件；相关 3 文件 23 pass / 0 fail，140 assertions，4.57s。用户提供的 500×439 RGBA PNG 通过一次临时 app/headless smoke：确认 f=100 上传、placement、元数据和无中文降级文案，109.64ms。原图未写入仓库；用户确认实际症状是图片和文案同时出现。最终门禁结果见 review.md。
