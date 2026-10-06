Status: claimed
Blocked by: 09

# 10: Tips 通用自动隐藏

用户要求为 Tips 增加通用隐藏时间，并确认默认值为 10 秒。

所有 PromptInput 的 tip 共用自动隐藏逻辑：内容出现或变化后最多显示 10 秒，内容清除时立即消失；重复的相同内容及无关重绘不重置倒计时。剪贴板一直有图片时，轮询继续但不重新显示已过期提示；探测到非图片后再次出现图片可重新提示。notice 优先级及现有生命周期不变，rewind 操作窗口仍为 3 秒，窗口结束会提前移除提示。隐藏不改变输入布局、光标或草稿，替换内容和卸载清理旧计时器。

## Comments

2026-10-06：基线 main `283a4ed`，工作树/分支 `codex/tips-auto-hide`。公开验证 seam 为 TUI start + injected host/headless terminal，以及 PromptInput + renderer terminal。默认 10 秒由用户回复确认；不增加设置项。

公开剪贴板回归先 red（1 fail：11.66 秒后仍可见），实现后 green（1 pass / 8 assertions）。默认时间回归在第 9 秒确认仍可见并编辑草稿，随后确认到期隐藏、同值轮询不复现、非图片→图片重新提示；组件回归验证替换内容不会被旧 timer 隐藏，compact 40×12 输入行与光标不移动，notice 优先、来源清除和重新出现正常。

Focused `rtk proxy env -u NO_COLOR bun test`：prompt-input、clipboard-image-tip、rewind 共 64 pass / 0 fail / 359 assertions / 3 files（56.15 s）。首轮漏清环境 `NO_COLOR=1` 导致既有颜色断言 4 fail；清除后单例与全部 focused 均通过。oxfmt、oxlint、tsc -b、Knip 与 diff check 通过。待双轴审查、main aggregate 及 clean/merged 工作树清理后关闭。

双轴审查初轮：Standards 0 项；Spec 发现 1 项 P2，Tab 补全递增 promptRevision 后重挂载整个 PromptInput，使已过期且来源未变的提示复现。已用公开回归复现 red（1 fail），将 revision key 收窄到编辑器及命令建议，Tips 生命周期保留在稳定的 PromptInput。修复后 clipboard-image-tip、slash-commands、input-history、images 共 48 pass / 0 fail / 143 assertions / 4 files（37.25 s），包含 Tab 补全后不重新显示提示；lint、tsc -b 通过。
