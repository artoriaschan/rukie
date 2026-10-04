# 08: TUI dashboard 与详情页

**What to build:**

- Agent Core：`session.interruptSubagent(id)`，中止该子代理当前的 run，父代理收到 `aborted` 通知并继续。
- TUI 新增两个整屏视图，用 chat 屏幕内的 state 做 early return，不引入路由层，完全复刻 dsh-TUI：
  - **dashboard**（`SubagentDashboard`）：Ctrl+A 打开；标题、计数、✕，卡片列表放在 `ScrollBox` 里；↑/↓ 移动，Enter 或点击进入详情，Esc / Ctrl+C 关闭，其他输入吞掉。
  - **详情页**（`SubagentDetailScene`）：固定头部；summary / output / tools 三页，←/→ 或点 tab 切换；output 页折叠 thinking、Markdown 正文、`● ` 工具行、`── Conclusion ──`，运行中自动跟随到底部；`x` 或 `X interrupt` 中断；Esc 返回进入前的位置（dashboard 或 chat，chat 恢复滚动位置）。不显示 one-shot / continuable 徽标。
- 消息流卡片点击进入详情。视图打开期间 run 继续，事件照常折叠。

**Blocked by:** 06

**Status:** claimed

参考：[spec](../spec.md)「Session API 与事件」「TUI」中的 dashboard / 详情页 / 屏幕切换；dsh-TUI `SubagentDashboard.tsx`、`SubagentDetailScene.tsx`。

- [x] e2e：`interruptSubagent` 后父代理收到 `aborted` 通知，父 run 继续；对空闲 / 不存在的 id 为 no-op
- [x] TUI e2e：Ctrl+A 打开 dashboard，↑/↓ + Enter 进入详情，Esc 关闭
- [x] TUI e2e：点击卡片进入详情；←/→ 切页；运行中 output 页跟随新输出
- [x] TUI e2e：`x` 中断后卡片变为 aborted；Esc 回到进入前的位置，chat 滚动位置不变
- [x] i18n zh / en 齐全；`tsc -b` 与全量 `bun test` 通过

## Comments

- 2026-10-04：已实施并验证；保持 `claimed`，等待协调代理完成独立 Standards / Spec 评审后 resolve。
- 工作分支：`codex/subagent-08-dashboard`；评审固定基点：`2daaf126cd022fc8a6174b4e50377bc8b07291ea`（01–06 已合并）。已检查实际 dsh-TUI Dashboard / Detail / Card 参考。
- 公开 TDD 接缝：`createSession` + faux model 验证指定子 Run 中断、`aborted` 通知、父 Run 继续与 missing / idle no-op；TUI 终端输入、鼠标、cells、screen 验证两种 locale、视图入口、键盘与鼠标分页、思考折叠、CommonMark、工具行、结论、tail-follow、中断与返回位置。
- 短窗口 16 行、8 张运行中或混合状态卡片的测试先发现固定 3 行滚动无法保持焦点可见；改为按选中卡片位置与高度滚动，Enter 打开正确条目，Esc 保持 Dashboard 的选择与滚动。
- `ScrollBox.initialTop` 在首帧前恢复阅读位置；chat 拥有视图、页签、选择、折叠与滚动状态，③层组件 props only。没有实现 09 面板。
- 8 个子代理同时启动时，原 chat 通知路径在同一事件循环中连续触发约 48 次更新，React `forceStoreRerender` 抛出 update-depth 错误。替换为基点原 chat / ScrollBox 后，未打开子代理视图的公开测试仍复现（10 次中 3 次失败）。仅合并 `subagent_event` 的 React 通知，每个事件仍立即按顺序折叠；普通父事件、提交、审批与中断维持同步通知，清除挂起通知，最后一个订阅离开时清理 timer。修复复现循环 10/10 通过，公开测试还验证全部 8 条 finished 通知和父最终回复，无 failed 通知。临时 DEBUG 诊断已移除。
- 完整验证：`rtk proxy env -u NO_COLOR bun run check` exit 0；1072 pass / 0 fail / 5816 assertions / 80 files，117.43s；日志 `/tmp/neant-subagent-08-check.log`。新视图文件单测 8 pass / 0 fail / 59 assertions；fork / subagent / view 定向组合已通过。新区域整理为 `index.ts` 入口后再次通过 tsc、knip、oxlint 与视图测试。
- 依赖：TUI exact `mdast-util-from-markdown` 2.1.0（micromark / CommonMark），已同步 lockfile 与 `docs/tech-stack.md`。
- main 合并、07 manager / latest-card 合并协调以及 worktree 移除由协调代理负责。
- 独立双轴评审：Standards 无 hard finding；Spec P2 指出 Tools 页遗漏执行结果、失败原因和耗时。追加公开终端成功 / 失败用例，先 RED（0 pass / 2 fail，缺少结果预览或错误原因），再 GREEN（2 pass / 0 fail / 8 assertions）。screen reducer 保存工具开始时间、耗时和结果 / 错误预览；Tools 页显示状态、工具名、耗时、缩进参数、`⎿` 成功结果及红色失败原因，预览按参考折叠空白并截断至 80 字符。
- 同次处理 Standards 可选建议：Dashboard / Detail 共享 typed status presentation map；06 消息卡片的动态 glyph 保持原实现。组合视图 / 06 卡片测试 18 pass / 0 fail / 103 assertions；`tsc -b` 通过。
- 评审修复后完整验证：`rtk proxy env -u NO_COLOR bun run check` exit 0；1074 pass / 0 fail / 5824 assertions / 80 files，120.09s；日志 `/tmp/neant-subagent-08-review-fix-check.log`。保持 `claimed`，等待协调代理复查、整合 07 与 resolve。
