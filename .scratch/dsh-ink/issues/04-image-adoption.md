# 04: 迁移图片为 bounded RGBA 与 Kitty/sixel

Status: in-progress
Blocked by: 03
Type: task

见 [spec](../spec.md) 与 [spike evidence](../spike-notes.md)。

应用拥有原图解码、裁切、缩放；renderer 接收不可变、有限 RGBA。范围是图片 decode/gallery/preview 与其 tests，不并行编辑 05 所拥有的 Chat 屏幕；最终接线协调经明确 exports。

- [x] PNG base64/original payload 在应用层解码为 dsh TerminalImageSource；保留完整原图以供原像素检查，transcript <=1024 edge/4MiB、preview <=2048 edge/8MiB
- [x] gallery 与预览使用新 Image/source/presentation/hooks；源像素 pan/crop 在应用层生成新的 immutable buffers，保留中心、缩放、drag、padding/resize/clipping 行为
- [x] 正确触发 demand probe，Kitty 与 sixel 均传递 protocol-specific presentation；无图形支持时保留 fallback copy
- [x] 改接 drag/wheel/cell metrics 新事件结构，移除旧 useTerminalGraphics、mime/base64/crop renderer contract 的消费者
- [x] 公开应用场景验证 8000x8000 admitted source 的缩图、bounded preview、透明/裁切/遮挡、资源释放；真实 worker 与 sharp 六色协议路径验证通过
- [x] 更新图片 owning docs 与测试，不创建旧图片 API facade

## Answer

应用层 `components/image-source.ts` 通过 pinned sharp 读取原始 encoded payload、按源像素裁切并生成 bounded immutable RGBA；完整原图仍由 PresentedImage/host 保存。gallery、preview 和 logo/portrait 消费原生 Image/source/presentation 与 demand/cell hooks；Box 原生 wheel/drag 事件替代全局旧输入事件。dragstart 与同一批次 dragmove 使用函数式 pan 更新，避免后一事件覆盖前一位移。

画廊只为绘制后可见的缩略图解码。新增 native `usePaintedViewport` 与 `renderer.subscribeFrame` 读取最新 Yoga、祖先 scrollTop 与 hidden/scroll 裁剪；首次绘制前 false，仅在可见性变化时更新 React。离开视口或 suspended 释放组件 snapshot，晚到的解码结果被丢弃。API 与 vendoring 差异记录在 ink README，图片产品文档在 TUI README。

## Verification

- TDD: image-source 首次失败为缺少公开 decoder；随后 8000×8000 原图获得 1024²/4 MiB Transcript 和 <=2048/8 MiB Preview；crop/alpha/独立 buffer 与 malformed input 通过。
- `bun test packages/coding-agent/tests/tui/components/image-source.test.ts packages/coding-agent/tests/tui/components/image-native.test.tsx packages/coding-agent/tests/tui/components/logo/logo.test.tsx packages/coding-agent/tests/ink/runtime.test.tsx`：21 pass，749 ms。图片/Logo 17 场景与基础 renderer 4 场景。
- 真实 Kitty/sixel 能力请求、实际 sharp 解码与 sixel worker、gallery 点击和清理、fallback modal ownership、scroll clipping/resize visibility、需求释放/late decode、100% measured pixel crop/wheel/drag、Logo 缩放退出与虚拟 animation cleanup 通过；单例均小于 1 秒，8000 source case约140 ms。
- owning files Oxlint 通过，`bun run check:ink-boundaries` 通过；`tsc -b` 的当前范围无错误，但整个迁移前沿仍有 05/06 所有的旧消费者/测试错误，未称整体 typecheck 通过。
- 旧 app image-preview/image ingress e2e 保留供 06 的应用接线回归；旧 renderer graphics suite 的协议/帧预算/多根/遮挡 cases 由 06 改接新 API。未运行 full aggregate，最终 gate 属于 06。

## Public app revalidation (reopened)

At integration8ea22b37 the six requested app image suites produced70pass6fail. Owning leaf regressions: images.test.ts631 caption retained4CJK instead of5 in10cells; image-preview.test.ts310 zh/en30x10 layout loses Open original (2cases). Cross-core: images.test.ts592 image notice shifts held reading rows; image-preview.test.ts359 preview close loses user header (APP owns). Sixth report image-preview.test.ts167 uses obsolete Kitty2147483647 probe/PNG placement assertions;06 migrates this protocol scenario, it is not counted as a demonstrated product defect. Original public assertions retained.04 remains in-progress until leaf fixes and cross-core public revalidation pass.

Leaf follow-up: gallery captions bound product names to actual slot cell width before native truncation (5CJK in10cells), and compact preview reserves fallback height plus fixed control rows and omits disabled pan/zoom controls at sub40 size. Original caption E2E passes; public native zh/en80→30→80 original-click cases pass. Original non-PNG tests now reach apphost click after restore (line316), pending shared overlay/Chat fix. No click-chain workaround or assertion deletion.04 remains in-progress.
