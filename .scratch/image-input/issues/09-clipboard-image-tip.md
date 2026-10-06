Status: resolved
Blocked by: 07, 08

# 09: 剪贴板图片 Tips

用户要求：剪贴板有图片时，右下角 Tips 显示 `Image in clipboard · ctrl+v to paste`，中文为 `剪贴板中有图片 · ctrl+v 粘贴`，通过 frontend i18n 按 locale 切换。

使用现有 Tips 槽位，剪贴板变化后更新，不修改草稿、读取图片 bytes 或自动粘贴。成功/失败 notice 和 rewind 提示保持优先级；输入不可编辑时不推荐 Ctrl+V。轻量元数据探测经 frontend host 注入，默认 macOS 检测 native PNG/TIFF 或 Finder 图片文件，Linux 检测 Wayland/X11 offers；Windows 沿用文本剪贴板能力。轮询串行，退出取消后续轮询并忽略晚到结果，default host dispose 等待已开始的探测。

## Comments

2026-10-06：基线 main `84deb4a`（相对 `0756b37` 仅另一任务的验收文档更新），独立工作树/分支 `codex/clipboard-image-tip`。公开 seam 为 TUI start + injected host/headless terminal，以及 default host + 子进程隔离的原生 helper 替身。zh/en 动态出现/消失测试先 red 2 fail，再 green；现有右对齐位置和输入行保持不变。

原生 macOS helper 替身覆盖 PNG、TIFF、Finder 混合文件、非图片文件/文本/空剪贴板、非法元数据及 dispose 后禁用；只调用元数据查询，不导出图片。真实 macOS 只读探测运行成功，当前剪贴板无图片，未改写用户剪贴板。

Focused：clipboard-image-tip、host/clipboard、image-clipboard、image-preview、prompt-input、interactions 共 40 pass / 0 fail / 217 assertions / 6 files，15.45 s。覆盖中英文动态变化、右对齐/原输入行、无 bytes 读取/模型调用、粘贴 notice 与 rewind 优先、小窗口/resize、probe 异常恢复、挂起 probe 不阻止编辑/退出及晚到结果不重绘。tsc -b、oxlint、Knip、oxfmt、diff check 通过。

实现提交 `34cf2e9`，main 合并提交 `4277f5c`。Standards：0 项规范违约、0 项判断项；Spec：0 项缺口/范围扩张/错误行为。Spec reviewer 独立运行新增公开测试 6 pass / 0 fail / 47 assertions。main 上 `rtk proxy caffeinate -is env -u NO_COLOR bun run check` exit 0：2193 pass / 0 fail / 11299 assertions / 158 files，261.18 s；格式、lint、类型与 Knip 全部通过。

工作树 clean 且分支为 main 祖先，经非 force worktree remove 和 branch -d 删除；其余任务工作树和用户未提交的后台 bash 工单修改保留。验收汇总见 [review](../review.md#剪贴板图片提示后续验收)，当前使用契约见 [TUI README](../../../apps/neant-tui/README.md)。
