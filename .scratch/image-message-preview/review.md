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

2026-10-06：修复提交 `f77ba35` 统一 geometry 计算、守卫子代理折叠及详情入口、保留已打开选择器的焦点。公开回归 red→green；Standards 独立复核 0 遗留项，Spec 独立运行两条鼠标隔离回归 2 pass / 0 fail / 16 assertions。详见 [04](issues/04-review-fixes.md)。

首次 integration aggregate 发现两条既有 40×12 选择器关闭后消息区空白：2175 pass / 2 fail。focused 稳定复现，ScrollSnapshot 追踪确认嵌套 flex 容器使 ScrollBox 保留一行 viewport；移除多余容器，消息区恢复原根级布局，预览仍为 absolute sibling。原测试断言不变。受影响四文件 98 pass / 0 fail / 458 assertions；fullscreen、streaming-burst、question-panel-parity、subagent-panel 73 pass / 0 fail / 527 assertions。

集成并行 main 更新 `bd64049` 时，只有 zh/en 新增文案键冲突，保留双方键。公开测试另复现新命令菜单遮挡图片预览控件，`44c3de8` 暂停预览期间的 suggestions 并守卫 sendInput；关闭后恢复 slash 草稿与菜单，不新增请求。相关三文件 31 pass / 0 fail / 173 assertions。两轴独立复核此小改动均无遗留项；Spec 独立复验 1 pass / 0 fail / 5 assertions。

最终 Standards：0 项规范违约、0 项未解决判断项。最终 Spec：0 项未解决行为问题。

## Main 集成与清理

main 集成提交 `9e895a2`，保留命令菜单更新和用户的后台 bash 工单修改。`rtk proxy caffeinate -is env -u NO_COLOR bun run check` 在 main 上 exit 0：format、lint、types、Knip、2187 tests / 0 fail / 11251 assertions / 156 files，271.10 s。两条原 40×12 选择器回归、图片预览及命令菜单共存回归均通过。期间 main 新增 `6661c63` 仅修改另一任务的工单记录；运行代码与被检查的 `9e895a2` 一致。

三个本次 Git 工作树 `image-message-ui`、`image-message-renderer`、`image-message-preview` 均在 clean 和分支已包含于 main 的检查后，用非 force 的 worktree remove 删除；对应三个 codex 分支用 branch -d 删除。其余工作树保留。用户未提交的 14-background-bash.md 内容 hash 前后一致，未暂存或编辑。
