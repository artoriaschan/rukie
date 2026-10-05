# 01: 恢复已结束子 Run 的历史状态

**What to build:** 用户关闭并恢复父 Session 后，能在现有子代理历史视图中看到子身份及最近一次 Run 的真实结束原因。当前运行活动与历史结束事实分开，正常结束不被当作整个委派任务已验收，旧记录保留未知。

**Blocked by:** None (can start immediately).

**Status:** claimed

- [ ] 每次子 Run 有稳定身份；开始执行前保存可关联子 Session 与 Run 的开始事实，结束事实先保存在子 Transcript，再更新父摘要。
- [ ] 父摘要保留子身份、最新 Run 关联和已知结束信息；旧 Run 的原始事实不改写，续跑产生新 Run 身份。
- [ ] 正常结束、错误或其他已知结束原因诚实保留；`completed` 仅表示该次 Run 正常结束，不宣称整个委派任务完成。
- [ ] 恢复已结算子 Run 时使用父摘要，保留原 Session id 和 Transcript，不创建子运行实例或请求模型。
- [ ] 旧子代理身份记录能够读取；缺少 Run 事实时呈现未知，不从 assistant 文本或 `idle` 推断完成。
- [ ] 模型侧 `list_agents` 的现有运行状态语义保持兼容；结束原因作为独立信息通过 Session 公共状态或事件可观察。
- [ ] TUI 手动子代理历史视图能展示最近 Run 的已知结束原因或未知；没有实际运行中的子 Run 时，自动列表保持隐藏。
- [ ] `send_message` 对空闲子代理复用原身份和历史，对活跃子代理保留 steer；最新呈现不会借用上一 Run 的完成原因。
- [ ] 只使用当前分支和所属 Session 的事实，Rewind 或 fork 继承上下文不能制造本次子 Run 的新结束事实。
- [ ] 新数据有版本且兼容现有 Tool State 与原生 Session Store，不替换 Agent loop 或 JSONL 格式。
- [ ] Core 公共入口测试覆盖正常结束与错误、同一子代理多次 Run、旧记录、重新创建 Session 恢复；TUI 启动入口测试覆盖历史状态与自动列表隐藏。

## Scope boundary

本工单打通已结算历史的持久化、公共呈现和 TUI 验证。正常关闭的等待边界与恢复摘要归 02；未结算 Run 的子 Transcript 核对和崩溃分类归 03；孤立 Tool 调用修复归 04。本工单不能把尚未核对的新 Run 擅自归为中断，也不新增恢复警告流程。

## Testing and delivery

以规范《Subagent 的 Run Outcome 与 Session Resume》、CONTEXT 和 ADR-0009 为准。复用 `createSession`、可控模型、真实临时 Session Store，以及 TUI 实际启动入口与虚拟终端；断言公共状态、模型请求、重新打开后的 Transcript 和可见输出，不直接测试内部 Map 或 reducer。使用公开完成信号同步。

由子代理使用 implement skill 在独立 worktree 中开发，完成有意义的行为测试及 Standards / Spec review，提交可集成的变更。集成按阻塞依赖进行；整批通过要求的检查后合并 main 并清理开发工作树。
