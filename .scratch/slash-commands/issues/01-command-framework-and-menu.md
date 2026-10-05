# 01: 命令框架与补全菜单

**What to build:** TUI 里输入 `/` 弹出补全菜单，列出内置 Slash Command 和用户可调用的 skill；内置命令由 frontend 执行，其余 `/` 输入原样交给 Agent Core（Skill Invocation 或普通 prompt）。本工单交付命令表、补全菜单、run 中可用性规则，以及不需要新 Agent Core API 的命令：`/help`、`/exit`、`/clear`、`/plan`、`/rewind`、`/goal`（占位）。其余命令（`/compact`、`/model`、`/resume`、`/context`、`/settings`、`/btw`、`/rename`）由后续工单逐个接入。见 [spec](../spec.md) 的“TUI：命令与补全”。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 命令名匹配规则：`/` 后接 `[a-z0-9-]+`，再跟空白或结尾；匹配到内置命令才由 frontend 执行
- [x] 不认识的 `/foo bar` 与以路径开头的输入（如 `/Users/x/a.ts 有 bug`）原样作为 prompt 发出；`/skill-name 参数` 照旧展开 skill
- [x] 补全菜单：单行且以 `/` 开头、有匹配项时显示；名字前缀匹配、不区分大小写；每行带说明；skill 行带 `[skill]`；同名时内置优先
- [x] 菜单按键：Up/Down 循环（菜单打开时优先于输入历史）、Tab 填为 `/name `、Enter 执行、Esc 关闭；多行输入不弹出
- [x] run 中：`/skill` 随 steer 发出；`/exit`、`/help` 可执行（`/exit` 先中止 run）；表中标记为 run 中可用的命令可执行；其余命令显示“run 结束后再用”的通知
- [x] `/help` 以本地静态输出列出内置命令与 skill
- [x] `/clear` dispose 当前 session、用相同 options 新建，清空对话区；旧 session 仍可 `--resume`
- [x] `/plan` 切换 plan mode（不走 `enter_plan_mode` 审批）
- [x] `/rewind` 打开现有回退面板，行为与双击 Esc 一致
- [x] `/goal` 提示“尚未支持”
- [x] 命令名、说明、通知文案进 i18n（中英）
- [x] TUI 测试（`start()` + 假终端）覆盖以上行为

## Answer

已交付 frontend 命令识别与完整清单、props-only 补全菜单、运行中可用性判断，以及 `/help`、`/exit`、`/clear`、`/plan`、`/rewind`、`/goal`。未知 slash 与路径保持原样；多行输入不打开菜单。`/plan` 依新 spec 改为切换，并在运行中拒绝；旧 plan/review/rewind 公共测试同步迁移。

扩展入口：`apps/neant-tui/src/screens/chat/commands.ts` 的清单与 chat 屏幕的 `executeCommand` 负责后续处理器接入；`replaceSession(resumeId?)` 支持 clear 与后续 resume。菜单通过 Agent Core 的 `listSkills()` 复用发现规则，过滤 `user-invocable: false`，内置命令覆盖同名 skill。

运行中 slash 输入经 Session 新增的 `steer(prompt)` 进入当前 Run，Core 继续负责 Skill Invocation。每次 skill steer 只占一个 pi 队列项，原始 user 文本和 `skillInvocation` 元数据一起持久化，在模型转换边界展开 reminder；界面与恢复回放只显示原始输入。未改变子代理通知的 one-at-a-time 调度，普通忙碌输入仍保留编辑草稿。

验证均经 spec 预先确认的 `start()` / `createSession` 公共边界：

- 命令与原有 plan/review/rewind：73 tests / 0 failures / 345 assertions。
- main、input history、子代理容量及 fork：77 tests / 0 failures / 378 assertions。
- 最终 folded-question 修正后的命令与 question parity：40 tests / 0 failures / 320 assertions；最终命令集另含 40×12 历史导航优先级：5 tests / 0 failures / 32 assertions。
- 当前源码 oxfmt、oxlint、tsc、knip、git diff --check 全部通过。
- isolated HOME 完整检查 `/tmp/neant-slash01-check-final.log`：1571 pass / 1 fail / 8145 assertions。唯一失败是运行过程中新增的 folded-question `/help` 回归测试，该进程此前已载入修正前的 chat 模块；上述修正后定向检查通过。最终整合分支仍须对精确合并 HEAD 运行完整检查。

后续工单负责 `/compact`、`/model`、`/resume`、`/context`、`/settings`、`/btw`、`/rename` 的实际处理器；目前这些清单入口给出尚未支持通知。
