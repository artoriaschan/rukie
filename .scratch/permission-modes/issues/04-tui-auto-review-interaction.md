# 04: TUI 的 auto-review 交互

Status: resolved

**What to build:** TUI 在 `auto-review` 下：评审进行时 ActivityLine 显示 REVIEW 文案；评审转来的审批对话框展示评审理由，只提供"允许一次"和"拒绝"。见 spec Implementation Decisions 的 TUI 节。

**Blocked by:** 02, 03

- [x] `mode === "auto-review"` 的审批请求，对话框只有"允许一次 / 拒绝"两项
- [x] 请求带 `reason` 时展示评审理由（后续用户要求：工具名作为标题，理由放入可滚动正文）
- [x] `ask` 模式对话框保持现有三项不变
- [x] ActivityLine 新增 review 状态与 REVIEW 文案池，由 `permission_review` start/end 驱动
- [x] chat screen 测试覆盖以上行为

## Comments

2026-10-03：完成。PermissionDialog 使用请求捕获的 mode 显示选项，reason 作为标题；没有 reason 时保留“权限确认”。显示、方向键循环和数字键选择共享选项定义，auto-review 的第二项实际拒绝工具调用，数字 3 被忽略。ask 仍提供原有三项；此前在 ask 下“一直允许”的工具，切到 auto-review 后仍需按评审结果确认。

ActivityLine 新增 review 展示状态和 REVIEW 文案池。Chat activity 按 toolCallId 跟踪 permission_review start/end，并发评审不会因其中一次结束而提前隐藏；审批打开时优先显示等待用户决定的文案，interrupt/result 清理评审状态。评审不影响主模型 token 计数。

公开 main/model/terminal 边界的测试覆盖两项显示、理由标题、数字/方向键/Esc 的实际拒绝、允许一次后再次询问、ask 原行为、并发评审逆序结束、评审失败转审批、取消、草稿恢复和 token 计数。审批与 REVIEW 新行为均先 red 后 green。全部 TUI 回归发现新测试会误匹配上一张尚未重绘的审批画面，已改为等待本次调用的独立参数详情。

验证：阶段性定向测试和 `bunx tsc -b` 通过；最终 `rtk proxy env -u NO_COLOR bun run check` 通过格式、Lint、类型检查、Knip 和全部 471 项测试（0 fail，2693 assertions）。

### Standards

未发现规范违规或需要处理的代码异味。Session/state 仍由 screen 持有，组件接收 props；可见选项与按键决定共用定义，测试使用 bun:test 和公开 TUI/model 边界。

### Spec

未发现缺项、错误实现或范围扩张；测试等待条件修正后复审仍为 0 项问题。

审查结果：Standards 0 项问题；Spec 0 项问题。

2026-10-03 用户后续要求：参考 dsh-TUI ApprovalPanel 更新权限确认面板。标题改为“等待审批 · 工具名”，bash 命令单独缩进展示，额外参数和其它工具保留 JSON；理由放入可滚动正文，确认问题与选项固定。普通窗口增加边距、分组留白和焦点强调；小窗口收紧布局，40 列时使用紧凑快捷键提示。ask 三项、auto-review 两项，以及数字键选择后 Enter 确认的行为保留。

本次跟进验证：40 项定向测试通过；Standards / Spec 两路审查均为 0 项问题。`rtk proxy env -u NO_COLOR bun run check` 通过格式、Lint、类型检查、Knip 和全部 472 项测试（0 fail，2712 assertions）。
