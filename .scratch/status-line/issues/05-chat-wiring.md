# 05: chat 屏幕接线、tps 采样与活动行压力前缀

Status: resolved

**What to build:** 见 spec 中 ④ chat 屏幕和 ③ `ActivityLine` 两节。

- `conversation.ts`：
  - Session 累计 usage，跨 Run 累加；
  - 保存最近一次 `context_usage`；
  - 采集 tps 样本：step 开始 500ms 后算实时值，`message_end` 时用实际值校正，Run 结束时入样，样本上限 500。
- `index.tsx`：换上新的 `StatusLine`；删除输入框上方的滚动提示行，改由第三行显示；活动行后缀去掉 `esc 中断`。
- `ActivityLine`：新增 `warnPct`，≥80% 时显示 `⚠ 上下文 N% · `，≥95% 改为 error 色。
- 收尾时把 `.scratch/working-activity/spec.md` 中关于后缀和滚动提示的描述同步过来。

**Blocked by:** 03, 04

- [x] 终端 e2e：footer 在 80、60、40 列下的三行内容
- [x] 终端 e2e：运行中第三行显示 `esc 中断`，结束后清空；活动行后缀不再出现 `esc 中断`
- [x] 终端 e2e：滚动离开底部后第三行出现提示，输入框上方不多占一行
- [x] 终端 e2e：悬停 ctx 或 model 显示明细，footer 高度不变
- [x] 终端 e2e：usage ≥80% 时活动行出现 `⚠ 上下文` 前缀
- [x] 终端 e2e：两次提交后 Session 累计 token 正确
- [x] 手动运行 `neant`，确认分段条颜色、hover 和 tps 显示
- [x] `bun run check` 全绿

## Comments

- Chat 接入常驻三行 StatusLine：模型、provider、thinking、最新 Context Usage、Session 累计 input/output/cacheRead/cacheWrite、git、cwd 和 tps。提交仅重置 Run 指标；resume 不回放历史 usage。
- tps 从首个 text/thinking/toolcall delta 开始计 decode 时间；500ms 后显示字符估算，每个 assistant message_end 用真实 output 校正；排除首 token 等待、工具及 Turn 间耗时。Run 结束记录一个样本，保留最近 500 个；刷新 deadline 与计算由 conversation 统一维护。
- hover 明细、滚动提示、工作中断提示共用第三行；删除输入框上方的滚动提示与 ActivityLine 中重复的 esc 后缀。活动行压力前缀在 80%/95% 使用 warning/error 色，原有 Run token 统计和小屏分支保留。
- 新增 10 个公开终端 e2e 和 3 个组件阈值用例，覆盖 80/60/40 列、两次提交、缓存累加、hover/滚动高度、压力色、decode 校正/多 Turn/工具 delta，以及 501 次 Run 后只保留 500 个样本。更新旧 footer 断言和 resume 从零开始的验证。
- PTY 冒烟：通过生产 main 入口与真实 stdin/stdout 运行，注入受控模型以提供确定的 usage/delta。验证主题分段背景色、85.9% 读数、ctx 原位仪表、model/tps 明细、第二次 Run 的 86% 压力前缀、累计 token 和退出时终端模式恢复。此项未调用真实 provider。
- 验证：`rtk bun x tsc -b` 和相关单文件测试通过；最终 `rtk proxy env -u NO_COLOR bun run check` 全绿，361 pass / 0 fail，格式、lint、类型检查和 Knip 通过。移除 NO_COLOR 以验证实际主题颜色。
- code-review：Standards 0 findings；Spec 0 findings。Standards 提出的 decode deadline 重复逻辑已收回 conversation；输入预算疑问经原 fullscreen 访谈与实现记录核对后撤回，输入框预算仍独立于活动行/状态栏。
- 已同步 `.scratch/working-activity/spec.md` 的后缀、第三行提示优先级和上下文压力描述。
- 2026-10-03 用户调整：仅提示行始终保留占位。缺少 Context Usage 或内容宽度不足 14 列时，上下文条不展示、不占行，字段行直接位于输入框下方；上下文条可见时仍为三行。组件测试验证隐藏/恢复及提示空行；80/60/40 列终端测试验证启动时字段行紧接输入框、hover 高度稳定，以及收到上下文后的三行布局。已同步两份 spec。
- 占位调整验证：`rtk bun x tsc -b` 与相关测试通过；`rtk proxy env -u NO_COLOR bun run check` 全绿（361 pass / 0 fail）。Standards 与 Spec 复审均无发现。
- 2026-10-03 用户调整：回到底部提示改为 dsh-TUI 风格的居中可点击按钮，独立放在正文下方、活动行/权限弹窗/输入框上方。第三行只显示 hover/中断/空占位；短窗口审批 chrome 预算保留所有关键行。实现与验收见 [06-scroll-to-bottom.md](06-scroll-to-bottom.md)，全量检查 490 pass / 0 fail，Standards 与 Spec 复审均无发现。
