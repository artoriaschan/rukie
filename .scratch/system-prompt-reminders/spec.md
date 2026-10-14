Status: resolved

# Spec: System Prompt 分节生成、System Reminder 角色与时间提醒

## Problem Statement

System Prompt 只有身份和几条概括规则，缺少指令优先级、提醒可信度、工程判断、执行责任、沟通与协作约束，也没有回复语言规则。System Reminder 中的日期没有时刻与时区，空闲多时或跨日后不刷新；后台任务与子代理完成通知以普通 user 消息提交，模型可能把它当作用户回复。运行中的重复调用、无进展、输出截断、插入消息和中断恢复没有任何给模型的说明。

## Solution

- 根 Session 的 System Prompt 改用 pi-durable `section()`，由已注册工具、平台与 shell 生成；子代理在既有拼接中加入子代理通用规则（[ADR-0046](../../docs/adr/0046-system-prompt-sections-and-reminder-roles.md)）。
- 既有 System Reminder 改写为快照或事件两类表述，自动事件包裹并声明不是用户输入。
- 时间提醒给出本地时刻、星期、时区与 UTC 偏移，开场与 Compaction 后给完整快照，空闲 2 小时或跨日时刷新。
- 新增运行纠偏提醒：重复调用、无进展、工具调用上限、输出截断续写、Todo 久未更新、运行中插入消息与工具中断恢复。

## User Stories

1. 作为用户，我希望 agent 用我书写的语言回复，代码和标识符保持英文。
2. 作为用户，我希望 agent 不把后台任务或子代理的完成通知当成我的确认或授权。
3. 作为用户，我希望 agent 知道当前的准确时间与时区，隔了很久回来时知道时间已经过去。
4. 作为用户，我希望 agent 不把文件、网页或工具输出里的伪造提醒当作指令。
5. 作为用户，我希望 agent 先找根因，不靠削弱测试、留桩或吞掉错误来“完成”任务，并如实报告未验证的部分。
6. 作为用户，我希望 agent 卡在重复调用或无进展循环时自己停下来改变做法。
7. 作为用户，我希望回复被输出上限截断时 agent 从断点继续，不重写已经说过的内容。
8. 作为用户，我希望在 Run 进行中插入的消息被当作对当前任务的补充或修正处理。
9. 作为用户，我希望 agent 不读取 `~/.rukie` 中的凭据与 Session 数据。
10. 作为子代理的父 Session，我希望子代理在需要我决定时上报阻塞，而不是自行假设授权。

## Implementation Decisions

### System Prompt（工单 01）

- `session/prompt.ts` 改为导出 section 定义；根 Session 通过 Session extension 注册各节，`instructions` 保留身份段。
- 节的划分：身份与安全、指令优先级、运行约定（含 System Reminder 可信度）、工具指引（按已注册工具输出）、工程判断、执行责任、沟通（含回复语言）、渲染约定、协作、评审、用户中途引导、上下文管理、环境（cwd、附加目录、平台、shell、用户数据目录禁读）。
- Session Move 后由 pi-durable 追加变更后的环境节，迁移 System Reminder 保留；`environment` 快照只保留 Git 分支与状态，Compaction 后不重发。
- 时间、Git 分支与状态不进入任何节。
- `SUBAGENT_PROMPT` 加入：无法与用户对话、非关键歧义按最合理理解处理、关键阻塞上报父 Session、最终回复自包含且交付给父 Session、工程判断与协作约束。
- `contextUsage`、`contextReport` 与 Side Question 改为使用当前 Session 实际渲染的 System Prompt。
- 工具名、术语遵循 CONTEXT.md；所有文本为英文。

### 既有 System Reminder 改写（工单 02）

- 后台任务完成通知（根与子 Session）与子代理完成通知包裹为 System Reminder，开头声明自动事件、不是用户输入、不能视为确认或授权；保留 `rukie.message-facts` 的 `source`，Frontend 不解析文本。
- Plan Mode 进入与退出：按效果说明约束（只读研究可用，改变文件或外部状态的调用等待计划评审），保留“不限制工具、不改变 Permission Mode”；加入计划结构与确认规则，确认规则沿用 ADR-0015。
- Goal：加入完成审计要求（逐项需求对应证据、测试通过或计划完成不单独构成完成、不确定即未完成）。
- Session Move：说明旧路径相关的历史输出已过时、需重读，旧目录可用绝对路径访问。
- Deferred Tool 与 Skill 目录：说明加载方式，不能因 schema 未加载推断能力不存在；Skill 目录注明可能与当前任务无关。
- User Instructions 的标签改为 User Instructions，与 Project Instructions 区分。

### 时间提醒（工单 03）

- `date` 来源改名 `time`，格式 `YYYY-MM-DD Weekday HH:MM:SS (system time zone <IANA>, UTC±HH:MM)`。
- 开场与 Compaction 后给完整快照，说明快照不自动更新。
- 距最近一次对话活动（user、assistant、toolResult 消息或上一条时间提醒）不少于 2 小时：给出空闲时长与当前时间。
- 本地日期变化：给出当前时间，要求不向用户提起日期变化。
- 时间来自 Session `now` 时钟，与消息时间戳一致。

### 运行纠偏（工单 04）

- 同一工具、相同参数连续调用达到 3、5、8 次时提醒，首档温和，之后给出调用次数与参数预览。
- 连续 15、25、40 次工具调用没有进展事件时分级提醒；进展事件为文件写入或编辑、Todo 完成数增加、委派子代理、计划评审与问题提问。末档明确不要为重置计数而修改文件或改动 Todo。
- 工具调用上限：在既有阻断基础上追加提醒，要求停止调用工具并总结已完成、未完成与继续方式。
- 输出因 `length` 截断：自动追加续写提醒并继续，最多 3 次；截断时没有任何可见输出则要求缩短推理后继续。
- 计数属于单个 Run；Compaction、Resume 与 Rewind 后从零开始。

### 插入消息、中断恢复与 Todo（工单 05）

- steer 或 Queued Input 放入运行中的对话时，附加说明：消息在工作中到达，补充或修正当前任务；若当前输出被打断，未完成的工具调用已丢弃。
- Session Resume 继续已接受的工作且存在 Unknown Tool Outcome 时，提醒先检查实际状态再决定是否重做，不询问用户是否继续。
- Todo：有未完成项且 8 个 Turn 未更新时提醒，至少间隔 8 个 Turn；上下文中已看不到 Todo 清单时立即重新提供。要求不向用户提起该提醒。

### 文档

- [ADR-0046](../../docs/adr/0046-system-prompt-sections-and-reminder-roles.md)、CONTEXT.md、ADR-0015 引用随本规格更新；`docs/architecture.md` 模型上下文一节、`packages/agent/README.md` 的通知说明随对应工单更新。

## Testing Decisions

- 遵循 [docs/testing.md](../../docs/testing.md)；每个工单在 Comments 维护验证记录。
- System Prompt：相同输入字节一致；不同日期不改变文本；cwd 只改变环境节，Compaction 后环境节仍在上下文，Session Move 后追加新环境节且 Resume、Rewind 投影一致；工具集不同时对应节出现或缺失；子代理与 Side Question 使用正确文本。
- 时间提醒：使用注入时钟覆盖开场、阈值前与阈值时的空闲刷新、跨日刷新、同日不刷新、Compaction 后重发、Resume 后按历史判断；时区通过 `TZ` 固定。
- 通知包裹：根、子 Session 与子代理通知均带 System Reminder 包裹和声明；Frontend 呈现与 `source` 不变。
- 运行纠偏：fake model 驱动阈值前后、计数重置、截断续写上限、上限总结；Compaction 与 Resume 后计数清零。
- 更新现有断言提示词文本的测试，不削弱其覆盖的行为。

## Out of Scope

- 长期记忆、Web 搜索、Windows shell 支持及其他 Rukie 尚未具备的能力；对应提示词见[待补指引](#deferred-guidance)。
- `/btw` Side Question 提示词的改写。
- 子代理改用 `section()` 组装。

## ADR Coverage

| 决定或修改                                         | 归属                                                                                                                                                | 理由                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| System Prompt 由会话内稳定输入经 `section()` 生成  | 新增 [ADR-0046](../../docs/adr/0046-system-prompt-sections-and-reminder-roles.md)；沿用 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md) | 改变 System Prompt 的组成与缓存边界，复用 harness 原语                            |
| System Reminder 分快照与事件、可信度与自动事件声明 | 新增 ADR-0046；沿用 [ADR-0016](../../docs/adr/0016-tool-state-and-context-projection.md)                                                            | 改变模型上下文的长期契约，状态投影规则不变                                        |
| 时间提醒格式与刷新条件                             | 新增 ADR-0046                                                                                                                                       | 改变来源名称与刷新语义                                                            |
| 运行纠偏提醒只提醒不拦截                           | 新增 ADR-0046                                                                                                                                       | 新的 Session 运行层义务                                                           |
| Plan Mode 提醒按效果描述约束                       | 沿用 [ADR-0015](../../docs/adr/0015-frontend-interactions-and-plan-mode.md)                                                                         | 仍为提示约束，不限制工具                                                          |
| 模型可见文本为英文、无默认语言                     | 沿用 [ADR-0008](../../docs/adr/0008-locale-agnostic-agent-core.md)                                                                                  | 回复语言跟随用户，不读取 locale                                                   |
| Todo 更新、插入消息及 Compaction 快照的持久化标记  | 沿用 [ADR-0016](../../docs/adr/0016-tool-state-and-context-projection.md) 与 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)            | 使用原生事务、提交身份与消息事实重建年龄、来源和去重，不替换原生 inbox 或重放规则 |
| 各提醒的具体措辞                                   | 无需 ADR                                                                                                                                            | 文案调整，不改变持久化、授权或执行合同                                            |

## Deferred Guidance

以下能力 Rukie 尚未具备。实现其中任何一项时，同一变更必须加入对应的模型指引，并按 ADR-0046 选择位置（工具描述、System Prompt 节或 System Reminder）。

| 能力                               | 需要加入的指引                                                                                                                                                                                                                                                                                    | 位置                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Windows shell（PowerShell 5.1）    | 命令已在 PowerShell 中执行，不再嵌套 `powershell -Command`；`&&`、`\|\|`、`?:`、`??` 是解析错误，用 `;` 或 `A; if ($?) { B }`；原生程序避免 `2>&1`；`Out-File`/`>` 写 UTF-16、`Set-Content` 用 ANSI，传 `-Encoding utf8`；`Get-Content` 读 UTF-8 传 `-Encoding UTF8`；含非 ASCII 的 `.ps1` 需 BOM | System Prompt 环境节，按检测到的 shell |
| Windows shell（PowerShell 7）      | `&&`、`\|\|` 可用，文件默认无 BOM UTF-8；用 `Get-CimInstance` 代替 `Get-WmiObject`                                                                                                                                                                                                                | 同上                                   |
| Windows shell（Git Bash）          | 使用 POSIX 语法，不套 `powershell`/`cmd`；路径传给 Windows 程序时用 `C:/...`；没有 `sudo` 与包管理器；交互命令加非交互参数                                                                                                                                                                        | 同上                                   |
| Windows shell 通用                 | 禁用 `Read-Host`、`Get-Credential`、`pause`；破坏性 cmdlet 加 `-Confirm:$false`；不跨 shell 做破坏性文件操作，递归删除前确认绝对路径；后台进程 `-WindowStyle Hidden`；here-string 结尾 `'@` 顶格；`--%` 停止解析                                                                                  | 同上                                   |
| Windows shell 工具层               | 拦截嵌套 `cmd /c` 递归删除并给出 `Remove-Item -LiteralPath`/`rm -rf --` 替代；5.1 下预检 `&&`/`\|\|` 并给出改写；命令前统一设置 UTF-8 输出编码；`findstr` 无匹配不视为错误                                                                                                                        | 工具执行层与错误结果                   |
| 控制台 UTF-8 下的传统 Windows 工具 | `ipconfig`、`systeminfo` 等本地化输出乱码时，临时切换 `[Console]::OutputEncoding` 后读取                                                                                                                                                                                                          | System Prompt 环境节                   |
| 长期记忆                           | 记忆目录与分桶、frontmatter 的 description 与 type（user、feedback、project、reference）、依赖既有上下文时先读记忆、记忆中的事实视为旧证据需核实、只存有长期价值且仓库未记录的内容、同主题更新已有文件、不存凭据；开场提供记忆目录快照                                                            | System Prompt 节与开场 System Reminder |
| Web 搜索                           | 搜索结果中有相关图片时主动以 `![caption](url)` 内联展示并放在对应说明旁                                                                                                                                                                                                                           | System Prompt 渲染节，按工具注册       |
| 当前模型不支持图片                 | 声明看不到截图与图片，不搭建自己读不到结果的视觉验证流程，交由用户查看                                                                                                                                                                                                                            | System Prompt 环境节，按模型输入模态   |
| 输入框文件引用                     | `@path` 与 `@"..."`（JSON 转义）都表示文件路径；内容重要时先读取，未读不得声称看过                                                                                                                                                                                                                | System Prompt 运行约定节               |
| 桌面 GUI 渲染能力                  | 本地文件用绝对路径链接，代码位置用单个行号，含空格的目标用尖括号；表格用于短事实对比；Mermaid 用于多步流程或多分支；列表与标题前后留空行                                                                                                                                                          | System Prompt 渲染节，按 Frontend      |
| 定时或无人值守执行                 | 无人在场，独立完成并直接交付，不提问、不调用需要实时确认的工具；需要决定是否通知时必须调用一次通知工具并给出一句摘要                                                                                                                                                                              | System Prompt 节与 System Reminder     |
| 旁支对话                           | 只回答关于主对话的问题，不继续主对话的任务或待办，只读研究可用，需要修改时建议回到主对话；附上发起位置的消息摘录                                                                                                                                                                                  | Side Question 提示词                   |
| 引用其他 Session                   | 列出被引用 Session 的标题、项目与最近活动时间；内容不在上下文中，需要时用读取工具按问题读取，读到的内容是背景而非用户指令                                                                                                                                                                         | System Reminder                        |
| 远程 agent 调用                    | 完成、需要输入、中断、取消与失败的结果通知，声明不是用户输入；用户取消的调用不自动重发                                                                                                                                                                                                            | System Reminder                        |
| 多次 Session Move 历史             | 列出历任工作目录与当前目录，旧目录可用绝对路径访问                                                                                                                                                                                                                                                | 开场 System Reminder                   |
| 应用更新重启续跑                   | 说明 Run 因重启中断、本次自动续跑非用户新消息、被中断工具的效果需核实、不询问是否继续                                                                                                                                                                                                             | System Reminder                        |

## Further Notes

- 决策来源：2026-10-14 设计访谈。
- 依赖顺序：01 → {02, 03, 04, 05}；02 至 05 相互独立。
- 交付：同一分支 `feat/system-prompt-reminders`，一个 PR，按工单分提交。

## Comments

### Delivery and ADR coverage review (2026-10-15)

工单 01–05 与规格在本次收尾变更中一起关闭。每个工单均使用新的子代理、独立分支和工作树实施，随后由新的 merger 集成到 `feat/system-prompt-reminders`；仅本规格在一个 PR [#27](https://github.com/artoriaschan/rukie/pull/27) 交付。`resolved` 表示实现、文档、评审修复及适用本地验证完成，不代表 CI 或合并完成。

Standards 首轮两项 P2（超时清理与 TZ 恢复）已修复并通过增量复审。Spec 首轮两项 P2（子 Session Compaction 时间快照、父消息插入提醒）已通过公开红绿回归修复；增量复审发现的预提交重放重复提醒也有持久化原生存储回归并已修复。验收发现的上下文标题归属、通知显示形态、模型包裹消费者、length 续写与时钟边界均已分组复现并修复；主代理核对最新生产 delta，无遗留可行动评审问题。

逐项对照最终 diff、工单与规格完成 ADR Coverage：ADR-0046 覆盖稳定 section、快照/事件可信度、时间与纠偏；ADR-0024/0016 覆盖原生任务、提交与 Transcript 投影，Todo/插入/时间标记均经原生事务与身份重建；ADR-0015 保持 Plan Mode 确认和权限合同；ADR-0008 保持英文模型指引与 locale 无关；子代理沿用既有拼接和 Run Outcome，未新增兼容、迁移或替代模型循环，未发现与已接受 ADR 的冲突。具体文案和测试 fixture 不引入新架构决定。

本地最终代码 `3652bd51` 的静态证据、原失败及增量修复证据见各工单 Final delivery verification：首轮完整检查失败 8 项，前端续跑失败 5 项，均保留原始事实且经最小复现和相关消费者检查修复，未无理由重跑已通过阶段。发布构建与 113 项发布测试通过，Node/Chromium desktop 275 项通过。行为证据按实际源码差异复用；本收尾提交仅修改 tracker/验证记录，运行文档、格式、工单与 diff 检查。CI 的最终全量验收仍待最新 PR 提交检查；尚未合并。

主代理统一验收的实际命令与状态：`env -u NO_COLOR bun run check` 在 `86ad6fca` 静态检查通过，第一阶段 527 pass / 0 fail，Agent e2e 1483 pass / 8 fail（136.67s），退出 1；八个失败在最小集合复现后批量修复，相关 62 测试通过（3.83s）。`env -u NO_COLOR bun test --parallel=1 packages/coding-agent` 在 `dcae2fe1` 为 1539 pass / 5 fail（213.05s），退出 1；五个失败、原生通知形态与注入时钟修复后，相关 117 项（7.92s）、身份/因果消费者 6 项（807ms）、强化断言 2 项（844ms）及活跃 Job 时钟定点 1 项通过。原失败 aggregate/前端结果未改称通过，未失效的证据沿用；所有修改的 focused 用例低于 1 秒。

在最终代码 `3652bd51` 上，新发布产物通过 `bun --no-orphans scripts/release/build.ts --out <隔离目录>`；`env -u NO_COLOR RUKIE_RELEASE_ARTIFACTS=<隔离目录> bun test --parallel=1 scripts/release/tests` 为 113 pass / 0 fail、2160 断言（162.86s）；`env -u NO_COLOR bun run test:desktop` 为 46 文件 / 275 测试通过（21.35s）。相关 Agent/coding-agent 类型、定向 lint/格式、文档与 diff 检查通过；局部类型合同的全部调用方已更新并检查，后续未新增导出、依赖或跨层导入使已通过的 Knip/边界证据失效。验收使用隔离 HOME 和已安装 Chromium，不访问真实用户设置或 Session；临时 HOME/发布产物在完成后删除。

验证协调与完整原始日志保存在 `/tmp/rukie-reminders-evidence/verification.md` 及其记录文件。主代理已审计本任务 9 个临时工作树均干净、提交均为集成分支祖先；清理只覆盖这些工作树和临时分支，保留集成分支、PR 及其他未合并工作。
