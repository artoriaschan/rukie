# 08: TUI /jobs 面板

**What to build:** TUI 用户用 `/jobs` 或点击 JobCard 打开整屏 JobsPanel，查看每个 job 的输出和时间线，并能手动停止 job。照 dsh-TUI 窄屏 overlay 复刻。详见 [后台 bash spec](../spec.md) 的 TUI 一节。

**Blocked by:** 07

**Status:** resolved

- [x] 新增内置 Slash Command `/jobs`，run 进行中也可以用；在 chat 屏幕内整屏 early return，与 subagent dashboard 的做法一致
- [x] 列出本 session 的全部 job；↑/↓ 选择；`e` 展开详情（输出尾部、时间线、spill 路径、丢数据提示）
- [x] `k` 第一次按下显示确认提示，4 s 内再按一次才调用 `killJob`；超时后确认失效
- [x] Esc 返回 chat，阅读位置不变；点击 JobCard 打开面板并聚焦这个 job
- [x] zh / en 文案、命令补全描述同步
- [x] TUI e2e：按键流程、停止后 Session 收到 `killJob`、Esc 返回后的滚动位置、run 进行中打开、小终端下正常显示

## Comments

2026-10-06：在 `codex/background-jobs-08` 认领；基线为已集成 01–07 的 `a4c18d4f88881186ef32cde41ff847ad2568a448`，消费冻结的 Session jobs/readJob/killJob 与 07 的 refreshJobs/JobCard.onOpen，不改 Agent Core。

## Implementation

- `/jobs` 在 Run 中可用，整屏 early return；单张及分组成员 JobCard 打开并精确聚焦 ID。列表保留已结束任务，↑/↓ 选择，`e` 展开，PageUp/PageDown 和滚轮浏览，支持 40×12 与 resize。
- 详情显示启动/转后台/结束的 UTC 时间、时长、退出码、spill 路径、丢弃提示和最多 8 行视觉输出尾部。输出净化与 grapheme 包装复用 JobCard helper；转后台时间保存在 process-local JobRow，Rewind 后仍保留，不持久化。
- `k` 对同一活动任务二次确认，4 秒过期；导航、其他按键和结束状态取消确认。调用真实 Session.killJob 后立即 refreshJobs，安静且抗 TERM 的进程也显示停止中；空闲停止不自动 Run，下一条用户 prompt 收到停止消息。
- 公共回归复现：面板期间上方 job 组结束折叠，返回阅读第 49–53 行变成 61–65 行。现有 renderer 锚点仅在 mounted 节点宽度变化时使用，无法跨整屏 remount。新增与 Agent/job 无关的 `Box.scrollAnchorId`、`ScrollSnapshot.anchor` 和 `ScrollBox.initialAnchor`；同宽 remount、文本 reflow、重复文本按稳定 ID 恢复，缺失 ID/path 回退 absolute top。保持已结束组立即折叠；流式 assistant 完成后保留相同 ID 与 host 子树路径。
- 新增 8 个 start/controlledModel 公共终端测试，真实 shell/marker、真实 kill 和 4 秒过期，不注入 spawn/clock；renderer 公共终端测试覆盖 duplicate text、remount、resize、follow 与缺失锚点回退。07 全部 9 个后台任务回归仍通过。

## Verification

- `env -u NO_COLOR bun test apps/neant-tui/tests/e2e/jobs-panel.test.ts apps/neant-tui/tests/e2e/background-jobs.test.ts apps/neant-tui/tests/screens/chat/slash-menu-parity.test.ts packages/tui/tests/renderer/fullscreen.test.tsx`：31 pass / 0 fail，176 assertions；日志 `/tmp/neant-background-jobs-08-focused.log`。
- `bunx --no -- oxlint` 与 `bunx --no -- tsc -b`：通过；最终 aggregate 同时重验 format、lint、types、Knip 与 tests。
- `env -u NO_COLOR bun test apps/neant-tui/tests/screens/chat/slash-commands.test.ts`：9 pass / 0 fail，43 assertions；同步新增 `/jobs` 后的 catalog 数量与末项期望。
- 冻结最终代码树上，以临时 HOME 运行 `caffeinate -is env -u NO_COLOR HOME="$check_home" bun run check`：exit 0；2280 pass / 0 fail，11957 assertions，166 files，327.41 s；日志 `/tmp/neant-background-jobs-08-final-check.log`。临时 HOME 已清理。
- 早先 red→green 期间的 aggregate 捕获 reading/promotion 红灯；随后 aggregate 为 2278 pass / 2 fail，仅旧 Slash Command catalog 数量/末项期望不符。均已修复，最终完整检查覆盖全部结果。
- `git merge codex/background-jobs`：Already up to date，基线仍为 `a4c18d4f88881186ef32cde41ff847ad2568a448`。`git diff --check` 与修改 Markdown 的 oxfmt 检查通过。

## Answer

08 已交付；所有勾选项有公共终端回归和完整检查证据。此次未修改 Agent Core、没有合并 integration/main 或归档 worktree。可恢复锚点要求调用方保持稳定 ID 与 host 子树路径；内容已移除或结构不匹配时按文档回退绝对阅读位置。
