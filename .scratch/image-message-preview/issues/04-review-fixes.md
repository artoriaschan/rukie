Status: resolved
Blocked by: 02, 03

# 04: 双轴审查修复

基线 `82500e0`，完整 diff `85d0dfa...82500e0`。由单一 implementer 修复 Standards/Spec 报告中的问题，保留各轴证据。

## Comments

2026-10-06 Standards：0 项规范违约；1 项低优先级判断项。图片预览 rendering 与 changeZoom 重复计算 zoom cell 几何和原像素 crop，应复用局部纯计算。

2026-10-06 Spec 初步发现：预览开启时，SubagentPanel 的子代理点击回调仍能打开详情并关闭预览。应通过公开 start/headless terminal 先复现再修复所有受影响的非 modal 入口。最终报告补充在 review.md。

2026-10-06：公开回归先复现子代理面板折叠/详情和模型选择器的鼠标焦点争用，再分别修复。openDetail 统一守卫历史卡片和底部面板，折叠回调也守卫预览；已打开的模型/恢复选择器保持鼠标所有权。关闭预览后原操作恢复，父子 Run 和草稿保留。渲染和缩放中心保留共用局部 geometry 计算，Fit 显式恢复全图。

首次 integration 全量检查 exit 1：2175 pass / 2 fail / 11186 assertions / 155 files。两项失败为原有 40×12 模型选择器及 CJK rewind 选择器关闭后消息区空白；focused 稳定复现。ScrollSnapshot 追踪确认多余的嵌套 flex 容器保留了选择器期间的一行 viewport；移除容器，让 ScrollBox 恢复根节点直接子级，预览仍为消息区的 absolute sibling。两条原测试断言保持不变，修复后通过；临时诊断代码已删除。

最终 focused：`rtk proxy env -u NO_COLOR bun test apps/neant-tui/tests/e2e/image-preview.test.ts apps/neant-tui/tests/e2e/images.test.ts apps/neant-tui/tests/screens/chat/model-switch.test.ts apps/neant-tui/tests/screens/chat/rewind.test.ts`，98 pass / 0 fail / 458 assertions / 4 files。布局与共存回归：fullscreen、streaming-burst、question-panel-parity、subagent-panel，73 pass / 0 fail / 527 assertions / 4 files。oxfmt、oxlint、tsc -b、git diff --check 通过。

Standards/Spec 独立复核均无遗留项。Spec reviewer 独立运行两条新增鼠标隔离回归，2 pass / 0 fail / 16 assertions。最终 main aggregate 和集成清理见 [review](../review.md)。
