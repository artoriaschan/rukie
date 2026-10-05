# 02: 正常关闭后的恢复提示与摘要

**What to build:** 用户在子代理执行期间正常关闭 TUI，关闭完成后子 Run 已停止并保存；恢复原父 Session 时收到一次说明，第一次真实输入时父模型得到一次恢复摘要。恢复本身不启动模型或子代理。

**Blocked by:** 01 — 恢复已结束子 Run 的历史状态。

**Status:** ready-for-agent

- [ ] 正常 Frontend 关闭取消拥有的父子 Run，等待已启动 Run 收束、结束事实保存与 Session Store 关闭，之后才报告关闭完成。
- [ ] 中止与实际错误结束分别记录，不将取消、失败或保存失败伪装为正常完成；关闭过程中不发起新的模型请求。
- [ ] 保留事件观察者可等待 `Session.dispose` 的语义，不让回调等待自己所属的 Run；外部关闭边界另行等待公共 Run 完成信号。
- [ ] 恢复已有中止、错误或未知结束信息时，Core 通过 Session 公共状态或事件提供结构化恢复结果，TUI 和模型使用同一组事实。
- [ ] TUI 每次恢复只出现一次说明，提醒明确中止、错误或未知项；正常结束不作为恢复警告，空摘要不产生提醒。
- [ ] 旧记录的未知状态能够加入恢复提示与摘要，而不是默默当作已完成。
- [ ] 第一次真实用户输入将本次摘要作为既有内部上下文追加到父 Transcript 并交给模型；提示、通知、Hook 内部续跑和重渲染不提前消费摘要。
- [ ] 同一次恢复后的第二次输入不新追加该摘要；关闭再恢复重新生成一次本次提示和摘要，已有 Transcript 中的信息继续自然保留。
- [ ] 无论父会话是否正在工作，自动列表都依据实际子 Run 活动；全部结束后隐藏，手动历史视图仍可访问。
- [ ] 不新增直接续跑按钮或快捷键；用户沿用输入让父代理经 `send_message` 继续原子代理。
- [ ] 恢复提示与摘要不创建 Checkpoint；第一次真实父 prompt 按既有规则创建锚点，之后子写入继续归父当前 Checkpoint。
- [ ] Core 保持 locale-agnostic；TUI 中英文提示在 40×12 和常用尺寸下可读，输入可用，不破坏现有高度预算。
- [ ] Core 和 TUI 公共入口测试覆盖关闭时有活跃子 Run、回调内 dispose、首次与后续输入、再次恢复、混合已知结束与旧未知、Checkpoint 及布局。

## Scope boundary

依赖 01 的 Run 事实和父摘要。本工单提供正常关闭收束与一次性恢复呈现，不读取未结算新 Run 的子 Transcript 来推断崩溃；这部分由 03 复用本工单的恢复结果与提示流程。Tool 结果未知的修复不在此工单，也不得将其错误地视为 Run 完成证据。

## Testing and delivery

以规范《Subagent 的 Run Outcome 与 Session Resume》、CONTEXT 和 ADR-0009 为准。复用 Core 的 `createSession`、真实临时 Session Store 与可控模型，通过公开事件和 Run promise 同步；TUI 通过实际启动入口、虚拟终端、`--resume`、用户输入和退出验收。不能只测试私有回调或 reducer，也不能将任意 sleep 作为关闭完成证据。

由子代理使用 implement skill 在独立 worktree 中开发，完成有意义的行为测试及 Standards / Spec review，提交可集成的变更。集成按阻塞依赖进行；整批通过要求的检查后合并 main 并清理开发工作树。
