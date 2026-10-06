# 图片消息预览审查

基线 `85d0dfa06c96c89021523d119d91d00630303a03`，首次完整审查 `82500e073449ef0060ce870fa23ecb7db0200c70`；diff `git diff 85d0dfa...82500e0`。需求见 [spec](spec.md)，修复票见 [04](issues/04-review-fixes.md)。

## Standards

未发现规范违约。renderer/application 责任、公开终端测试 seam、Session 独立性、双语文案、生命周期清理和文档归属符合仓库要求；工具强制检查项不列入人工审查。

判断项（P3，possible Duplicated Code）：`apps/neant-tui/src/components/image-preview/index.tsx` 的 rendering 与 changeZoom 重复计算 zoom cell 几何及原像素 crop。改变几何规则需同时更新两处；提取局部纯计算并复用，Fit 显式处理。此项是维护建议，非已证明的行为故障。

Standards 合计：0 项规范违约，1 项低优先级判断项。

## Spec

P2：`apps/neant-tui/src/screens/chat/index.tsx` 仍给 SubagentPanel 提供活动的 onToggle/onOpen 回调，绕过预览输入所有权。规格要求：“浮层拥有键盘与鼠标输入，草稿及消息阅读位置保留，后台 Run 继续”；02 要求“键鼠输入隔离”。公开 start + headless terminal 复现：点击 Subagents 折叠面板但预览仍开；点击子代理打开详情并关闭预览。应守卫两类动作并加入公开回归。

未发现额外具体缺口、范围扩张或错误行为；PNG-only Kitty 与输入 token hover 不在本次范围，符合已明确规格。

Spec 合计：1 项 P2 行为问题。

## 验证边界

PNG fixture 为有效 CRC/zlib 图片；headless terminal 验证终端控制序列、画面布局和交互，但不解码 Kitty 像素。此次没有人工验证真实 Kitty raster，不能将协议断言当作真实终端像素截图验收。缩放过滤器由终端选择；终端 cell 向下取整可能留下不足一个 cell 的等比例边距。

## 修复与最终验证

待 04 修复、双轴复核和最终 main aggregate 记录。
