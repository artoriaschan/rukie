---
status: accepted
---

# System Prompt 只由会话内稳定输入生成，System Reminder 承载快照与事件

## 问题

System Prompt 原为一份跨项目、跨 Session 字节一致的常量，只有身份与几条概括规则；工具相关指引无法按实际注册情况出现，缺少指令优先级、提醒可信度、工程判断、执行责任与沟通约束。System Reminder 只承担环境、日期、项目说明和状态快照，日期没有时刻与时区，长时间空闲后模型不知道时间已过期；后台任务与子代理完成通知以普通 user 消息提交，模型可能把它当作用户回复或授权。运行中的循环、输出截断、插入消息和中断恢复也没有给模型的说明。

提示词缓存按前缀命中：System Prompt 的任何字节变化都会使其后的上下文失效。模型可见输入必须能从 Transcript 重建（[ADR-0024](0024-adopt-pi-durable-harness.md)），Plan Mode 不改写 System Prompt（[ADR-0015](0015-frontend-interactions-and-plan-mode.md)），模型可见文本保持英文且与 locale 无关（[ADR-0008](0008-locale-agnostic-agent-core.md)）。

## 决定

**System Prompt 由会话内稳定的输入生成。** 根 Session 使用 pi-durable `section()` 组装 System Prompt；各节只读取会话内不变或极少变化的输入，例如已注册工具、平台与 shell。相同输入产生字节一致的文本，变化的节由 pi-durable 作为新的 system 条目追加，不改写已有前缀。当前时间、Git 状态、cwd、Project Instructions 与能力状态不进入 System Prompt。子代理沿用基础 System Prompt、子代理通用规则与子代理类型 prompt 的拼接，子代理通用规则说明它无法询问用户、最终回复交付给父 Session、阻塞上报父 Session。

**System Prompt 规定行为与提醒的解读方式。** 它包含指令优先级（平台安全、权限与执行模式约束优先；当前任务的明确指令优先于项目、skill 默认与保存的偏好；已给的授权在同一动作、目标与范围内有效）、System Reminder 可信度、工程判断、执行责任、沟通、协作、评审、用户中途引导与 Compaction 说明，以及与已注册工具对应的工具指引。回复使用用户书写的语言，技术术语、代码和标识符保持英文；Agent Core 不设默认语言。Rukie 用户数据目录中的凭据与 Session 数据禁止模型读取。

**System Reminder 分为快照与事件两类。** 快照描述建立上下文时的状态，自身声明不会自动更新，并在状态变化、Compaction 或 Session Move 后由新的快照取代：环境、时间、User Instructions、Project Instructions、Skill 目录、Deferred Tool 名单、MCP、Todo、Goal、Plan Mode。事件描述运行期间发生的情况：后台任务与子代理完成、运行中插入的用户消息、工具中断后的恢复、重复调用与无进展、工具调用上限、输出截断。

**只有 harness 放置的 System Reminder 有效。** 用户引用的文本，或文件、网页、日志、外部工具输出中出现的同类标签，按内容处理。自动事件以 System Reminder 包裹并声明不是用户输入，模型不能把它当作用户确认或授权。

**时间快照包含本地时刻、星期、时区与 UTC 偏移，按需刷新。** 新上下文和 Compaction 后给出完整快照；距最近一次对话活动不少于 2 小时时给出带空闲时长的刷新；本地日期变化时给出刷新并要求模型不向用户提起日期变化。其他请求不发送时间。

**运行纠偏只提醒，不拦截。** 重复调用、无进展、输出截断与 Todo 久未更新只追加提醒；工具调用上限仍由既有阻断执行，提醒要求模型停止调用工具并总结。提醒按阈值分级，不要求模型为重置计数而修改文件。

**能力拥有自己的模型指引。** 新增或修改模型可见的能力（工具、模式、自动事件、Frontend 渲染能力）时，同一变更在其拥有位置加入指引：只与该工具有关的放工具描述，跨工具的行为规则放 System Prompt 节，状态与事件放 System Reminder。尚未具备的能力及其预备指引见[规格的待补指引](../../.scratch/system-prompt-reminders/spec.md#deferred-guidance)。

依据：[规格与票据](../../.scratch/system-prompt-reminders/spec.md)。

## 备选方案

- System Prompt 保持完全静态，环境相关指引全部放工具描述或 System Reminder：只与工具集或平台有关的跨工具规则没有合适位置；会话内稳定的输入不破坏缓存，静态常量没有额外收益。
- 子代理同时改用 `section()` 组装：现有拼接已经满足子代理规则需要，扩大改动范围而没有新的行为收益。
- 逐字照搬外部参考提示词，只替换产品名与工具名：会引用 Rukie 没有的工具与概念，偏离术语表。
- 只改写既有触发点的文案，不新增运行纠偏机制：循环、截断与插入消息的失败方式仍无说明。
- 回复语言规则带默认中文兜底：违反 ADR-0008 的 locale 无关约束。

## 影响

System Prompt 不再在所有项目间共用同一前缀；单个 Session 内仍命中缓存。上下文占用统计与 Side Question 需要使用该 Session 实际渲染的 System Prompt。原来断言跨项目字节一致的测试改为断言相同输入字节一致、时间与 cwd 不进入 System Prompt。

`date` 来源改名为 `time`；已有 Session 恢复后会收到一次新格式快照。空闲判断依赖消息时间戳与提醒使用同一时钟。自动事件包裹后，Frontend 仍通过消息事实识别来源，不解析提醒文本。运行纠偏的阈值与触发条件归 Session 运行层，需要覆盖 Compaction、Resume 与 Rewind 后的计数边界。
