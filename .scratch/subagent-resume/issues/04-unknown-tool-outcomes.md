# 04: 缺失 Tool 结果的恢复

**What to build:** 用户实际恢复一个 Session 时，已有 Tool 调用却缺少结果的项目被持久化为“结果未知”，原调用保留，TUI 和模型都能理解这种不确定性。恢复不自动重放 Tool；历史子 Session 仅在之后实际续跑它时修复。

**Blocked by:** None (can start immediately).

**Status:** claimed

- [ ] 实际恢复对应 Session 时，在当前分支中识别有已保存调用却缺少匹配真实结果的 Tool；不修改已有真实结果。
- [ ] 在新 Run 请求模型前，追加与原调用身份关联的持久化恢复信息及协议兼容结果表示；恢复占位能够区别于真实 Tool 结果。
- [ ] 该信息明确说明结果未知，不能据此认定成功、失败或尚未执行，也不能认定没有副作用；模型收到先核对实际状态再决定重试的指导。
- [ ] 不修改原始调用，不把 provider 临时补出的缺失结果文字当作已持久化事实，不自动执行原 Tool。
- [ ] 重复恢复同一 Session 不重复追加同一调用的修复信息；正常、错误和恢复占位混合的调用批次保留各自含义。
- [ ] 仅恢复父 Session 不读取或修复所有历史子 Session；之后 `send_message` 实际恢复原子 Session 时，先完成它自身的结果修复，再执行新 Run。
- [ ] 子代理续跑继续复用原 id 和历史，活跃子代理 steer 行为不变；恢复信息不创建子运行实例或提前请求模型。
- [ ] TUI 使用现有 Tool 历史呈现说明结果未知，而非伪装成普通执行失败；Core 保持 locale-agnostic，中英文界面呈现事实一致。
- [ ] Compaction 与 Rewind 后只处理当前分支可达的调用，不能重新引入被移出分支的调用或重复恢复占位。
- [ ] 恢复修复不创建 Checkpoint，实际父 prompt 和子后续文件写入仍遵循现有父 Checkpoint 规则。
- [ ] Core 公共入口测试覆盖孤立调用、已有真实结果、混合批次、重复恢复、父与子实际恢复、当前分支以及模型请求内容；通过文件或可控 Tool 副作用计数证明恢复没有重放。
- [ ] TUI 实际启动入口与虚拟终端测试覆盖恢复后的未知结果历史呈现和之后的正常输入，包含中英文与窄终端。

## Scope boundary

本工单依赖既有 Session Resume、Tool 调用身份、Transcript 和 `send_message` 公共行为，不依赖 01 的新 Run Outcome 格式，因此可以独立开发和验收。它不负责父子 Run 关闭收束、恢复提示投递或未结算 Run 的核对分类；这些分别由 02、03 完成。

不推断外部操作成败、不撤销未知副作用、不自动重试，也不增加独立工具调度或消息队列。

## Testing and delivery

以规范《Subagent 的 Run Outcome 与 Session Resume》、CONTEXT 和 ADR-0009 为准。复用 Core 的 `createSession`、真实临时 Session Store 与可控模型，以及 TUI 实际启动入口和虚拟终端。采用真实中断或合法存储夹具构造孤立调用，重新创建 Session 验证持久化与幂等；不以私有修复函数测试代替公共恢复验证。

由子代理使用 implement skill 在独立 worktree 中开发，完成有意义的行为测试及 Standards / Spec review，提交可集成的变更。集成按阻塞依赖进行；整批通过要求的检查后合并 main 并清理开发工作树。
