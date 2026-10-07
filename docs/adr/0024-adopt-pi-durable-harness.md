---
status: accepted
---

# 采用 pi-durable 原生执行与恢复，移除旧 harness 和数据兼容

## 问题

Rukie 使用 pi-agent-core 的旧 harness 能力，而 pi 1.0.4 已移除这些入口。只保留新版 Agent loop 再自研存储、压缩与工具基础设施，会扩大 Rukie 的执行职责；在新 harness 外维持原有调度与恢复语义，又会形成两套生命周期。

用户需要升级目标依赖并恢复进程退出后的未完成工作，接受实验性、API 破坏性变更及旧 Session 数据不兼容。

## 决定

Agent Core 采用 pi-durable Harness 作为唯一执行与持久化基座，移除 pi-agent-core，不引入 pi-coding-agent SDK。所需 pi-ai、pi-mcp、pi-durable、Chord 及 Pi 支撑包精确对齐到已选择的 1.0.4，具体依赖事实归 [技术栈](../tech-stack.md)。API 可重写，所有仓库消费者一起更新，不维护旧接口 shim、旧 harness fallback 或数据迁移器。

本决定已接受，尚未实施。迁移范围和验证归 [实施规范](../../.scratch/pi-durable-migration/spec.md)及其票据；当前运行行为仍以源码和拥有该能力的使用文档为准，不能以 ADR 的 accepted 状态推断升级已完成。

### 执行与恢复

原生 Harness 拥有提交、任务 ownership、调度、工具执行阶段、原子提交、事件、Compaction 和恢复。Session 负责组合配置、环境、extensions、观测及 Frontend 交互；不另建第二套模型循环或在宿主模拟旧父 Run 等待行为。恢复所选 Session 后启动原生恢复，继续已接受但未结算的任务；列表、预览和只读观测不启动执行。

工具 intent 先提交，执行结果之后提交。恢复按原生 replay 规则：仅当持久化 intent 与当前工具定义都声明 safe 时重跑；其余已进入执行阶段的中断调用返回 interrupted，保留已提交输出。稳定 requestId 和任务身份用于逻辑工作去重，不承诺任意外部副作用 exactly-once。Rukie 只对能证明重放安全的扩展声明 safe，恢复路径同样检查当前权限。

### 持久化与状态

Headless CLI 和 TUI 使用原生 JSONL 目录，包含提交文件与 document/task sidecars，并启用 fsync。一个宿主进程独占一个 storage，宿主保证重复打开被拒绝，不假设上游有跨进程锁。新目录与旧数据隔离，旧文件保留但不枚举、不读取、不写入。Session 枚举和恢复使用新身份与索引。

Rukie Session 映射到 durable Conversation，父子 Conversation 与任务 ownership 在同一 Harness 内恢复。durable 的底层 Session 容器名不改变产品术语。Tool State 由所属能力的 typed documents 保存，根据恢复、fork 和 Rewind 需要选择历史策略；Transcript 保留追加事实，模型上下文采用原生投影，Frontend 的当前消息快照不是完整历史。

文件 Checkpoint 与 write/edit 的备份范围继续生效；对话 Rewind 采用原生 fork/context 与 documents 的历史投影，保留原对话，替代旧 main branch tip 操作。Rewind 不复制旧任务活动，父子仍有活跃工作时拒绝。原始图片、文件基线与提醒的原子提交义务继续生效。

### 自有能力与 Interaction

Rukie 自有工具、Permission Decision、Hook 协议、Plan Mode、Goal、Checkpoint/Rewind、图片、Background Job、MCP、Side Question 和 Frontend 能力继续保留，以原生 extensions、hooks、documents 和 tasks 接入。Plan Mode 仍独立于 Permission Mode，项目配置与凭据的信任边界不改变。

durable 的 hooks 不是现成的权限审批或用户问题协议。Rukie 保存可恢复的请求事实与阶段，恢复未完成审批、Plan Review、问题和 OAuth 时，依据当前配置重新判定并重新发起；临时 allow 不恢复，旧回调失效，不能把进程关闭当作批准。Headless CLI 仍无 Interaction 回调，依赖交互的工具隐藏，Core 自发请求取安全默认值。

Goal 的活跃续跑工作保存为原生任务与提交，在恢复后继续；轮次与输入身份持久化，避免重复计数与提交。暂停、受阻、完成、耗尽或已取消的目标保持停止，不能因为存在 Goal facts 就新建续跑任务。创建或重新开启 Goal 仍需真实用户授权。

### 子代理与宿主生命周期

Subagent 默认采用 background anchor task 与 owned Conversation。后台 ownership 是父 idle 与普通 abort 的边界；父 Run 可以先结束，后台子代理不会因此取消。稳定 child 身份与持久化 reporter 保证结果在可用后提交给父 Conversation，恢复不重复创建或逻辑投递。显式停止子代理取消其相应 ownership scope。

Frontend 的整次请求结算与父 Run 结束分开。Headless CLI 等待本次输入或 Goal 引发的后台子 Run、reporter 与后续结果处理完成，随后输出最终结果并退出；排除空闲长期 anchor、历史身份和无关工作。stream-json 可流式发布已提交事实，但最终完成记录只在整个请求结算后发布。

正常 TUI 退出与 Headless 主动中断调用 close：停止当前进程的 invocation，保存未完成任务并完成资源关闭。Esc 使用原生 abort，默认不跨后台边界；显式停止子代理才取消对应工作。close 不等于 abort，不写入伪造的结束 outcome。关闭后没有 daemon 继续运行，下次打开才继续。

Background Job 仍是宿主 OS 进程资源，关闭清理进程和输出，Resume 不恢复进程、不自动重放 bash。原生可恢复 Task 与活 OS 进程必须分别呈现。

### 替代关系

- 完整替代 [ADR-0002](0002-reuse-pi-agent-core-harness.md) 的旧 harness 复用决定。
- 部分替代 [ADR-0003](0003-dual-session-store.md) 的 session repo 接口、单文件 JSONL 和关闭边界；保留 JSONL 的选型及未来 SQLite 后端方向，本次不实现桌面存储。
- 部分替代 [ADR-0009](0009-subagent-resume-outcomes.md) 的恢复不续跑及缺失结果修复策略；保留活动、Run Outcome 和委派任务验收的区别。
- 部分替代 [ADR-0010](0010-own-bash-tool-for-background-jobs.md) 的退出和子 Run 收尾协调；保留自研 bash、Job ownership、进程清理与不恢复 OS 进程。
- 扩展 [ADR-0015](0015-frontend-interactions-and-plan-mode.md) 的跨进程交互恢复；保留 Frontend 回调、安全默认、晚到回复无效及 Plan Mode 独立性。
- 部分替代 [ADR-0016](0016-tool-state-and-context-projection.md) 的完整状态消息快照、旧分支投影和进程开关；保留能力事实归属、模型上下文与完整 Transcript 的区别。
- 部分替代 [ADR-0017](0017-checkpoint-and-branch-rewind.md) 的 main branch tip 与旧恢复引擎约定；保留真实输入锚点、备份范围、原历史与非外部世界回滚。
- 部分替代 [ADR-0018](0018-goal-state-and-idle-scheduling.md) 的进程内 armed 和旧 idle scheduler；保留目标事实、真实用户授权、暂停/完成/受阻/上限及轮次义务。

其他能力所有权、目录依赖、授权、MCP 凭据、文件基线、图片、终端和 locale 决定继续沿用；完整覆盖归实施规范。终端基线沿用已接受并合并的 [ADR-0013](0013-adopt-dsh-tui-ink.md)：固定来源 dsh ink、公开组件/hooks、immutable RGBA 和 root 退出义务，不恢复 ADR-0005 的旧自研管线。必要局部 runtime 改动仍维护固定来源 diff 与 renderer README，依赖方向由当前 ink AST 边界检查约束。

## 备选方案

- 保留 pi-agent-core 1.0.4 的 Agent loop，自行补齐被删除的 harness：可保留旧调度，但需要重新承担存储与基础能力；用户选择全面采用 durable。
- 采用 durable 后维持旧 Run/Resume 行为：减少可见变化，但限制原生恢复，并形成宿主与原生的两套执行规则；用户明确选择以 durable 执行逻辑为准。
- 对旧 Session 做一次性迁移：保留历史可恢复性，但增加格式与状态映射成本；用户明确旧数据无需兼容。
- 本次统一切换 SQLite：原生支持该后端，但用户选择继续 JSONL；桌面存储不在本次范围。
- 默认采用前台 owned 子代理：父 idle 与 abort 直接覆盖子工作，但用户选择默认后台及持久化通知，并由 Headless Frontend 单独等待整次请求。

## 影响

恢复会执行未完成工作，正常退出不再表示已取消，父 Run 结束不再表示后台子代理已结算。Headless 与 TUI 必须区分这些状态，并明确 close、abort 和显式子代理停止的作用。

旧 Session 不再可由新版恢复；API、事件、存储和输出契约允许变化，相关消费者、当前文档与测试必须一起更新。原生工具和状态不能覆盖的自有能力仍由 Rukie 维护；尤其图片读取、权限交互、Goal、Checkpoint 与 Background Job 需要实际适配。

实验性 API 和 Bun 集成增加升级风险，先用精确发布依赖验证最小运行、原生 JSONL、工具 hooks、流式观测、关闭与重启，再迁移能力。最终以公开 Session、实际重启与 Frontend 行为测试验证，文档检查不构成运行验收。
