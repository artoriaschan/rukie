Status: resolved
Blocked by: 01

# 03: Kitty placement 与终端生命周期

完成 [spec](../spec.md) 中 renderer 生命周期责任。仅 fullscreen 与 Kitty 支持、tmux/screen 禁用；PNG 分块上传、图片上传去重、有界资源、placement 随布局/滚动 clip/resize 更新，离屏及终端清理删除。区域裁剪支持预览缩放和平移。探测回应、pixel cell 回应及 DA 哨兵不得污染输入，分块和晚到回应均验证。支持 held-primary motion，用 generic move.button 暴露拖动。inline 不输出图形。支持最大已准入 PNG 或有可观察降级。通过公共 render 终端测试验证协议与成功、错误、resize、离屏、卸载清理；同步 renderer README。

## Comments

2026-10-06：01 基线 27262b3 已在集成提交 5bf5111 验证。renderer implementer 继续拥有 packages/tui，02 独立拥有 apps/neant-tui；依赖接口保持一致。公开 seam 为 render/useInput + injected terminal。

2026-10-06：完成。Image 支持原像素 crop，与 ScrollBox 的位移/clip 合并；同 PNG 多 placement 共用上传，滚动只更新 placement，离屏删除数据，resize 重建。fullscreen Kitty runtime 支持与 cell metrics 独立；tmux/screen/inline 不输出图形。分块及晚到 APC/cell/DA 回复不污染输入，held-primary motion 暴露 move.button=0。source header/base64 验证阻止控制字节；资源只留哈希/ID，32 张、32 MiB 原始 PNG 字节、64 Mi pixels 有界，包含已准入最大 8000×8000 PNG。生命周期失败/卸载清理并恢复终端。README 同步；没有复制 dsh renderer 或新增依赖。

公开 seam 的 red→green：缺少 Image/hook 导出、拖动 motion、滚动重复上传三个行为先失败后通过。graphics.test.tsx 8 项覆盖 literal crop/placement、chunk payload、去重/预算、真实 8000×8000 PNG、晚到分块回复/DA 与相邻键、resize/offscreen、paint failure/raw-mode 恢复。首轮颜色相关旧测试受 NO_COLOR 影响；按仓库要求清除后通过。全 renderer 运行发现 resize 查询造成旧 hover 等待条件过早；只在已确认 Kitty 时刷新 cell metrics 后，89 pass / 0 fail / 519 assertions / 18 files，2.43s。

验证：`env -u NO_COLOR bun test packages/tui/tests`；`bunx --no -- oxfmt --check packages/tui`；`bunx --no -- oxlint packages/tui`；`bunx --no -- tsc -b packages/tui`；`bunx --no -- knip` 全部退出 0。集成后的全仓 `env -u NO_COLOR bun run check` 由集成 agent 执行。
