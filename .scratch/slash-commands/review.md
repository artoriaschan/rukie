# Slash commands delivery review

Branch: `codex/slash-commands-integration`。初审范围为 `git diff bc57750374f00318b30c1eb6f1b0259031e98faf...d9812dc7561d3f8aa69352776dfc2b52fa6d9451`；修复复核范围为 `git diff d9812dc..6622452`，修复已合入 `a5fd79d0592e638039d9d1ac295474131d1da283`。

Standards 与 Spec 由两位独立代理并行审查，再由同一位实现代理修复全部接受的问题。原审查代理分别复核修复提交。

## Standards

初审发现 1 项 P2 规范违反：新增 Agent Core 可见错误直接携带固定英文，违反 `docs/adr/0008-locale-agnostic-agent-core.md` 的错误码与 frontend 本地化职责。涉及侧问失败/空响应、清洗后为空的改名、模型与压缩互斥以及 PreCompact hook 停止。

已解决：`@neant/shared` 定义稳定错误码与参数，`@neant/i18n` 提供中英文通用文案，TUI 统一分派；provider 原因以 `cause`、hook 原因以 `reason` 保留，无原因失败使用独立码。公开边界回归覆盖两种语言、改名校验、互斥守卫与有无原因的 hook 阻断。复核未发现新的模块、UI 分层或运行时边界违反。

辅助模型测试 helper 重复的启发式疑虑经复核撤回：各包具有独立 TypeScript composite 项目边界，目前没有共享测试支持入口，保留包内副本符合测试目录约定。

结果：1 项接受的规范违反已解决；剩余 0 项硬性违反、0 项可操作启发式异味。

## Spec

初审发现 1 项 P2 行为缺陷：规格要求 `/exit` 先中止当前操作再退出；手动压缩中的取消异常会让 `conversation.stop()` 拒绝，导致退出回调没有执行。公开 `start()` 复现确认摘要已取消，但 `app.exit` 未完成且出现未处理的 `CompactionError`。

已解决：停止逻辑捕获当前操作、中止并等待其结算，再处理取消拒绝与解绑，让退出回调继续执行。压缩命令自身仍可收到真实失败。公开回归确认 held summary 被取消后正常退出，真实 provider 失败仍显示、原对话保留且下一条 prompt 可继续。复核独立验证 37 pass、0 fail、187 assertions。

结果：1 项接受的 Spec 缺陷已解决；剩余 0 项遗漏、范围扩张或错误实现。

两轴各解决 1 项，均无剩余问题。

## Verification

- 首次整合 `d9812dc`：完整 `bun run check` 退出 0；1648 pass、0 fail、8587 assertions、127 files。
- 修复提交 `6622452`：109 pass、0 fail、776 assertions、10 files；oxfmt、oxlint、tsc、knip、diff 检查通过。
- 修复整合 `a5fd79d`：55 pass、0 fail、316 assertions、5 files；tsc 与 diff 检查通过。
- `a5fd79d` 完整检查出现 1 个测试同步失败：1654 pass、1 fail。测试把 usage 更新误当作 run 已结束；此前恢复选择器的偶发超时也来自加载标题早于可选行。受控公开 Stop hook 与 store.list 分别稳定复现旧顺序失败，修正后等待实际 idle / 可见焦点行，五轮聚焦验证每轮 27 pass、0 fail、160 assertions。两位审查代理复核该增量无新增发现，生产代码未改。
- 最终整合 `efd8f67`：完整 `bun run check` 退出 0；**1655 pass、0 fail、8615 assertions、127 files，194.92s**。oxfmt、oxlint、tsc、knip 均通过。日志：[完整检查](/tmp/neant-slash-final-check.log)；交付记录见 [spec Answer](spec.md#answer)。全量检查使用隔离临时 HOME、清除 NO_COLOR，并通过 caffeinate 防止空闲休眠。

八张工单及审查修复的 managed worktrees 均已归档，临时分支已删除；保留整合分支。
