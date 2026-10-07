# 03: 状态行渲染与接线

Status: resolved

**What to build:** 用户可见的工作状态行，见 spec ③④ 节。

- `components/activity-line/` 的 `ActivityLine` 负责帧、扫光和 subtle 色的 suffix，单行截断。
- `conversation.ts` 把事件喂给 02 的 reducer，并跟踪 `↑` / `↓` token。
- `index.tsx` 把状态行放在输入框上方，suffix 为 `· ↑ … · ↓ … tokens · esc 中断`，并派发 `approval-open` / `approval-close`，按 `nextWakeAt` 刷新。
- 启动时读一次 git 分支。
- `StatusLine` 删掉 `Running` / `Ready`。

Blocked by: 01, 02

- [x] Run 进行中显示状态行；成功、失败或打断结束后隐藏，下次提交时重新显示；启动后首次提交前不显示
- [x] 流式过程中 `↓` 增长，`message_end` 后校正为真实 usage
- [x] 权限对话框打开时显示"在等你点头"
- [x] 状态栏不再出现 `Running` / `Ready`
- [x] 冒烟测试：首格为月相帧、文字加粗、suffix 为 subtle 色、超宽时单行截断
- [x] e2e：用假 `streamFn` 跑一次带工具的 Run，断言状态行在运行中显示、结束后隐藏
- [x] 手动运行 `neant` 确认扫光、帧和颜色
- [x] `bun run check` 全绿

## Comments

- 2026-10-02（后续调整）：用户确认人工视觉验收已完成，并要求 Run 结束后隐藏 ActivityLine。屏幕仅在 Run 进行中渲染状态行并安排 nextWakeAt，成功、失败、打断或 Run 异常退出后隐藏；底部 token 统计、错误提示及回复正文保留。状态机内部 done 终态不变。同步规格和终端 e2e 等待条件。
- 后续调整验证：先更新生命周期 e2e，确认旧行为因保留 done 行而失败，再修改屏幕渲染条件。29 个 activity/main 定向测试及 26 个 TUI e2e 全通过；`rtk proxy env -u NO_COLOR bun run check` 退出 0，格式、lint、类型检查、knip 全绿，271 tests passed，0 failed。
- 后续调整双轴 code-review：以 `311bf55` 为基准审查暂存区，Standards 0 项发现，Spec 0 项发现。

- 2026-10-02：实现 ActivityLine 月相帧、扫光、加粗、subtle suffix 与显示列截断；done 不订阅动画。conversation 同时驱动 activity reducer，累计文本和 thinking 的输出估算，在 message_end 校正 usage；输入显示最近 Turn 的 usage，输出跨 Turn 累计。屏幕接入审批开关、nextWakeAt 刷新和一次性 git 分支读取，StatusLine 移除 Running/Ready。04 自述指令注入与正文剥离未纳入本次。
- 新增 2 个组件冒烟测试和 3 个 e2e，覆盖首次提交前隐藏、实时 token、跨 Turn 校正、审批、done 保留与替换、thinking 和向下校正、git 分支只读取一次；同步现有 Run 完成与 resume 断言。headless xterm 默认 Unicode 6 将月相 emoji 解释为 1 列，测试终端加载官方 @xterm/addon-unicode11 0.9.0 以按 2 列解释；依赖版本同步到 docs/tech-stack.md。
- 双轴审查：Standards 无规范违规，提出的 token 格式化重复已合并；Spec 无实现缺陷，手动视觉验收仍未完成。
- 验证：`rtk proxy env -u NO_COLOR bun run check` 退出 0，格式、lint、类型检查、knip 全绿，264 tests passed，0 failed。真实 TUI main 在 80×24 PTY 配合假 streamFn 跑完 waiting → thinking → bash 工具 → done 并退出 0，确认输出月相/扫光 ANSI 与汇总；该验证不替代手动视觉验收。
- 待人工：工具安全限制阻止访问原生 Terminal（com.apple.Terminal），未能肉眼确认扫光、帧速和颜色，因此保留该项未勾选，状态为 ready-for-human。
