Status: claimed
Blocked by: 02, 03

# 04: 双轴审查修复

基线 `82500e0`，完整 diff `85d0dfa...82500e0`。由单一 implementer 修复 Standards/Spec 报告中的问题，保留各轴证据。

## Comments

2026-10-06 Standards：0 项规范违约；1 项低优先级判断项。图片预览 rendering 与 changeZoom 重复计算 zoom cell 几何和原像素 crop，应复用局部纯计算。

2026-10-06 Spec 初步发现：预览开启时，SubagentPanel 的子代理点击回调仍能打开详情并关闭预览。应通过公开 start/headless terminal 先复现再修复所有受影响的非 modal 入口。最终报告补充在 review.md。
