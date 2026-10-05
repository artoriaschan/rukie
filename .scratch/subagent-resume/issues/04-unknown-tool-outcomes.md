# 04: 缺失 Tool 结果的恢复

**What to build:** 用户实际恢复一个 Session 时，已有 Tool 调用却缺少结果的项目被持久化为“结果未知”，原调用保留，TUI 和模型都能理解这种不确定性。恢复不自动重放 Tool；历史子 Session 仅在之后实际续跑它时修复。

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] 实际恢复对应 Session 时，在当前分支中识别有已保存调用却缺少匹配真实结果的 Tool；不修改已有真实结果。
- [x] 在新 Run 请求模型前，追加与原调用身份关联的持久化恢复信息及协议兼容结果表示；恢复占位能够区别于真实 Tool 结果。
- [x] 该信息明确说明结果未知，不能据此认定成功、失败或尚未执行，也不能认定没有副作用；模型收到先核对实际状态再决定重试的指导。
- [x] 不修改原始调用，不把 provider 临时补出的缺失结果文字当作已持久化事实，不自动执行原 Tool。
- [x] 重复恢复同一 Session 不重复追加同一调用的修复信息；正常、错误和恢复占位混合的调用批次保留各自含义。
- [x] 仅恢复父 Session 不读取或修复所有历史子 Session；之后 `send_message` 实际恢复原子 Session 时，先完成它自身的结果修复，再执行新 Run。
- [x] 子代理续跑继续复用原 id 和历史，活跃子代理 steer 行为不变；恢复信息不创建子运行实例或提前请求模型。
- [x] TUI 使用现有 Tool 历史呈现说明结果未知，而非伪装成普通执行失败；Core 保持 locale-agnostic，中英文界面呈现事实一致。
- [x] Compaction 与 Rewind 后只处理当前分支可达的调用，不能重新引入被移出分支的调用或重复恢复占位。
- [x] 恢复修复不创建 Checkpoint，实际父 prompt 和子后续文件写入仍遵循现有父 Checkpoint 规则。
- [x] Core 公共入口测试覆盖孤立调用、已有真实结果、混合批次、重复恢复、父与子实际恢复、当前分支以及模型请求内容；通过文件或可控 Tool 副作用计数证明恢复没有重放。
- [x] TUI 实际启动入口与虚拟终端测试覆盖恢复后的未知结果历史呈现和之后的正常输入，包含中英文与窄终端。

## Scope boundary

本工单依赖既有 Session Resume、Tool 调用身份、Transcript 和 `send_message` 公共行为，不依赖 01 的新 Run Outcome 格式，因此可以独立开发和验收。它不负责父子 Run 关闭收束、恢复提示投递或未结算 Run 的核对分类；这些分别由 02、03 完成。

不推断外部操作成败、不撤销未知副作用、不自动重试，也不增加独立工具调度或消息队列。

## Testing and delivery

以规范《Subagent 的 Run Outcome 与 Session Resume》、CONTEXT 和 ADR-0009 为准。复用 Core 的 `createSession`、真实临时 Session Store 与可控模型，以及 TUI 实际启动入口和虚拟终端。采用真实中断或合法存储夹具构造孤立调用，重新创建 Session 验证持久化与幂等；不以私有修复函数测试代替公共恢复验证。

由子代理使用 implement skill 在独立 worktree 中开发，完成有意义的行为测试及 Standards / Spec review，提交可集成的变更。集成按阻塞依赖进行；整批通过要求的检查后合并 main 并清理开发工作树。

## Answer

实际打开原 Session 时扫描当前 Transcript 分支，追加关联原 `toolCallId` 的协议兼容结果；`details.recovery` 的 `unknown-tool-outcome` v1 标记区分恢复占位与真实执行结果。固定英文模型文案保留成功、失败、是否执行和副作用的不确定性，并要求核对实际状态后决定是否重试。恢复本身不运行模型或工具，也不创建 Checkpoint。

父 Session 恢复不修复历史子记录；`send_message` 冷续跑在原子 Session 上先修复，再接收新 prompt。Compaction 前的分支事实仍被持久化修复，但模型上下文过滤已不含对应调用的恢复占位；不重新引入被压缩调用。Rewind 只恢复当前分支事实。TUI 既有 Tool 卡使用 `?` 与中英文未知说明，保持输入与布局可用。

## Comments

- 公共测试边界沿用已批准的 `createSession` + 可控模型 + 真实临时 Session Store，以及 TUI `main/start` + 虚拟终端，没有新增私有函数或内部状态测试。
- Red → green：Core 初始孤立调用测试先失败（恢复结果数量 0，期望 1）；TUI 中英文 40×12 测试先失败（出现普通成功图标与未本地化的英文占位）；Compaction 持久化测试先失败（已压缩前缀调用未修复）。各切片随后通过。
- 新增 Core 5 个 E2E，涵盖真实结果与占位混合、幂等、父恢复与实际子续跑、当前分支、Compaction、模型请求内容与无重放副作用。新增 TUI 4 个 E2E，覆盖中英文 40×12 与 80×24 恢复及正常后续输入。子继续写入仍归父 Checkpoint，测试通过代码 Rewind 验证删除。
- 相关 Core/TUI 回归：`env -u NO_COLOR bun test` 加 9 个相关文件，102 pass / 0 fail，763 assertions。日志 `/tmp/neant-subagent-resume-04-focused.log`。初次未移除继承的 `NO_COLOR` 导致既有 TUI 颜色/鼠标焦点断言失败，正确环境重跑已通过。
- 完整检查：`env -u NO_COLOR bun run check` 退出码 0；format、lint、`tsc -b`、knip 通过，全套 1576 pass / 0 fail，8205 assertions，116 files。日志 `/tmp/neant-subagent-resume-04-check.log`。开发期间也多次独立执行 `bunx tsc -b`，最后一次通过。
- TUI 新增 `@earendil-works/pi-agent-core` 0.99.2 直接 devDependency，仅用于原生 Session Store 的合法孤立调用夹具与 BACKGROUND_CONTEXT；不通过跨包 node_modules 路径导入。版本与 Agent Core 既有锁定版本一致，运行时依赖未变。
- 已同步集成 tip `c27b1e6`。主线程安排在整批集成后统一进行 Standards / Spec 双轴并行审核；当前两轴审核待完成，未声明审查通过。
