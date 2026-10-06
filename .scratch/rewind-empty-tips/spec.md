# Rewind 空状态 Tips

## 已确认需求

2026-10-06，用户通过 `grill-with-docs` 提出：没有用户消息时，触发 Rewind 的提示放在输入框右侧 Tips，不进入消息流；中文文案为「还没有可回退的消息」。用户回复「全部采用推荐」，确认以下规则并授权实施。

- 空闲、输入为空时，首次 Esc 仍显示「再按一次 Esc 回退」，3 秒内第二次 Esc 才尝试打开 Rewind；无 Checkpoint 时显示空状态 Tips，不打开选择器。
- `/rewind` 直接尝试打开 Rewind；无 Checkpoint 时显示相同的空状态 Tips。
- 空状态 Tips 沿用现有 10 秒生命周期。编辑草稿不会清除或延长提示，重复相同内容不重新计时；提示内容变化或来源清除后重新出现时采用新生命周期。
- 英文沿用 `Nothing to rewind yet`。提示不进入消息流、Transcript 或模型上下文。
- 复用输入框现有 Tips 位置、覆盖优先级和窄终端处理；不改变双 Esc、退出准备、通知和剪贴板提示的原有行为。
- 提交真实用户消息后清除空状态提示，新 Session 不继承提示。

## 归属与验收

该行为属于 TUI Frontend 的局部反馈，不改变 Checkpoint 或 Rewind 的领域定义与持久化语义，无需新增领域术语或 ADR。使用说明归属 `apps/neant-tui/README.md` 的输入提示段落。

通过 app `start()` 与 headless terminal 验证双 Esc 和 `/rewind`、中文和英文、40×12 与 80×24、resize、右对齐位置及输入框位置不变。验证提示随输入保留、重复命令不延长 10 秒生命周期、提示消失后消息区没有残留。

## 实施与验证

已完成。`openRewind()` 的空列表分支使用 Chat 局部状态向 `PromptInput` 提供 Tips，保留首次 Esc 的准备窗口；接受真实用户输入后清除该状态，Session 切换通过现有组件重建清除状态。中文使用指定文案，英文保持原有文案；使用说明已同步到 TUI README。

- 回归测试在修正前失败：中文仍显示旧文案，英文空状态位于消息区，重复 `/rewind` 后提示不消失。修正后新增 5 个用例均通过。
- 初次运行因工作树缺少依赖报 `Cannot find module '@neant/agent'`，执行 `rtk proxy bun install --frozen-lockfile` 后恢复，无锁文件变更。
- 未清除 `NO_COLOR` 的相关测试运行结果为 58 pass / 4 fail；失败为既有 picker 颜色、prompt 颜色和两种 Plan Mode 边框颜色断言。清除变量后的完整检查中这 4 项全部通过。
- `rtk proxy env -u NO_COLOR caffeinate -is bun run check`：退出 0，格式、lint、类型检查、Knip 和全量测试通过；2413 pass / 0 fail，12538 次断言，173 个测试文件。
- `rtk proxy bunx --no -- oxfmt --check apps/neant-tui/README.md .scratch/rewind-empty-tips/spec.md` 与 `rtk proxy git diff --check` 通过。
