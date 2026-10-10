# Session Store

`createSession` 默认使用原生 JSONL Storage，同一目录保存父子 Conversation、entries、documents 和 tasks。`SessionStore` 提供 `open`、`list` 与身份 `key`；自定义后端返回 Storage 和可重复调用的 `release`，Session 关闭时释放资源。默认路径由 [`store/`](src/store/index.ts)按解析后的工作目录生成，位于 `homeDir/.rukie/durable-sessions/`；`rukie.session` document 保存 id、名称、模型与选中对话等索引事实。旧 `.rukie/sessions/` 文件不枚举、不读取、不改写，旧 id 打开返回 `session-not-found`。

一个宿主持有一个目录的写者租约。默认实现通过独立 SQLite 文件的 `BEGIN IMMEDIATE` 事务持有内核锁；该文件不存 Session 记录，也不删除或替换。另一个进程或宿主打开同一 id 立即失败，错误携带 `session-busy` 和 `{ id }`，同进程重复打开也使用该错误；正常关闭和进程死亡释放锁。恢复无需 PID 检查或清理旧租约。列表可以观察活跃目录：当前宿主借用已注册读者，独立查询仅打开原生存储内核读取索引，不启动模型或 Harness scheduler，也不执行任务恢复。`listSessions` 跳过索引读取失败的单个 Session，并经 `onWarning` 上报包含 id 与失败原因的警告；未提供回调时使用 `console.warn`，项目目录本身的读取失败仍向调用方传播。需要截断或修复的存储拒绝只读观察。

原生 JSONL 启用 sidecar fsync，[存储文件适配器](src/store/files.ts)在成功追加后 flush 文件，包括 main 提交标记；提交确认后才采用状态和发布对应成功事实。写入或 flush 失败会向调用方传播；原生 Storage 进入 poisoned 状态时须 `await session.close()` 后重开。flush 发生在追加之后，拒绝确认不等于磁盘字节回滚，重新打开时以原生已提交事实为准。进程强制退出测试验证租约释放和恢复，不代表断电测试。

`SessionOptions.initializationSignal` 可取消 SessionStart Hook 与打开过程，失败时关闭 observation、撤销注册读者并释放 Hook／连接／存储租约。这个信号只约束初始化，Session 返回后不会取消 Run；原生 Harness 的上下文独立于它。已打开宿主通过 `await session.close()` 保存 pending work 并等待释放；`abort()` 取消当前普通 ownership，`interruptSubagent()` 取消选中的 child。Frontend 的进程信号及输出边界见 [Headless README](../coding-agent/src/headless/README.md) 与 [TUI README](../coding-agent/src/tui/README.md)。

# Pending interactions

Permission、Question 和 Plan Review 的 Frontend 请求包含 `identity`：原生 task／conversation 身份和按交互种类区分的稳定 request id，以及当前 callback 的 epoch。OAuth 由原生工具发起时也包含该身份；管理面板发起的登录使用管理操作自身的生命周期。回调必须观察 request signal，及时撤回 UI；Core 自身也限制等待并检查取消，旧回调晚到不能授权恢复后的任务。

原生 task 的未执行阶段与已提交 pending memo 支持 close/reopen 后按当前信任、规则、Hook、参数和 Frontend 能力重新判定、重新发起请求。close 撤回当前 callback，保留未执行的逻辑请求；明确 deny、decline 或 abort 产生的终态不会重新等待。临时 allow 和 callback 回复留在当前 invocation，不恢复。无相应回调时依赖交互的工具不可用，冷恢复生成真实不可用结果而不等待不可达 Frontend。

Question 和 Plan Review 在原生执行意图之前收集回复；计划批准后的状态变更仍属于普通 unsafe 执行。OAuth 的挑战、listener 与授权等待可重发，替换请求使用新的 state／verifier；code exchange 只在原生 unsafe 执行意图提交后开始。进入执行后关闭或崩溃仍遵守 Unknown Tool Outcome，不能因旧 pending memo 自动重放业务变更或一次性授权 code。客户端注册和远端授权不承诺崩溃下 exactly-once。OAuth 配置、凭据归属及管理操作见 [MCP](../../docs/mcp.md)。

# Document policies

能力通过 typed documents 保存事实，版本与内容校验失败阻止恢复，不跳过坏值继续运行。Session 协调事实在 Harness／启动 Hook 之前校验父子 Conversation 中的当前内容，每次原生 document 读取和 definition-free fork copy 也校验精确来源及历史版本；损坏的历史内容不会因当前值已修复而获准复制。fork admission 失败遵守原生 poisoned Session 合同，须 close 后重开，不写入成功复制或默认状态。Tool State document 的初始 `value: null` 表示尚未建立该状态；拥有者规定清空方式，例如 Todo 使用空数组、Plan 使用 `{ active: false }`，Goal 清空使用 null。声明和校验由各能力源码负责，注册层在同一原生事务中提交状态与必要提醒。

| 事实及声明处                                                                                                 | 历史 / fork          | 恢复与 Rewind                                                                |
| ------------------------------------------------------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------- |
| [Todo](src/tools/todo/state.ts)、[Goal facts](src/tools/goal/state.ts)、[Plan](src/tools/plan-mode/state.ts) | rewindable / asOf    | 恢复锚点时的事实；Goal 事实不代表激活自动续跑                                |
| [Checkpoint](src/checkpoint/index.ts)、[文件跟踪](src/file-tracking/index.ts)                                | rewindable / asOf    | 恢复原输入锚点及模型已知基线                                                 |
| [子代理 Run](src/tools/subagents/state.ts)                                                                   | rewindable / asOf    | 保存历史 Run Outcome，与当前任务活动区分                                     |
| [子代理目录](src/tools/subagents/state.ts)                                                                   | rewindable / initial | 新 fork 不继承拥有的子代理目录；顶层 Rewind 按目标位置重新建立可观察身份     |
| [模型选择事实](src/config/model-state.ts)、[标题来源](src/session-title/index.ts)                            | rewindable / asOf    | 保留所选位置的产品事实；实际模型与 Thinking Level 从原生 Agent document 恢复 |
| 原生 `pi.agent`                                                                                              | rewindable / asOf    | 保存 Model Selection 与 Agent 配置；Session 索引用于列表展示                 |
| [Goal 激活](src/tools/goal/driver.ts)、[待提交输入事实、子代理描述](src/session/index.ts)                    | latest / initial     | 当前活动事实不复制到新 fork                                                  |
| [Session 索引](src/store/index.ts)                                                                           | Session scope        | 保存持久化身份及当前选中 Conversation，不参与对话 fork                       |

# Queued Input

Run 进行中调用 `session.followUp(prompt, { images? })`，返回稳定 `requestId`；输入在当前 Run 回答后的原生边界按发送顺序逐条放入，每条是独立用户消息并开始下一 Run。空闲时调用会直接启动 Run。`session.queuedInputs` 与 `snapshot.queuedInputs` 提供原文、图片数据、MIME 与名称；`queued_inputs_update` 提供已提交队列的新投影。队列使用原生 `pi.inbox` 持久化，崩溃后 Resume 显示尚未放入的输入并继续原顺序。

`session.withdraw(requestId)` 在放入前原子撤回，返回 `{ status: "withdrawn", input }`；身份不存在、已放入或已撤回时返回 `{ status: "not_queued" }`。`session.steerNow(requestId)` 把所选输入改为在当前工具轮完成后放入，返回 `steered` 或 `not_queued`，保留 requestId。`session.abort()` 等待正在接受的输入，原子撤回全部 Queued Input，再停止当前 Run，返回按排队顺序排列的原文与附件数组，Frontend 负责交还输入框。`close()` 保留已接受输入，供下次 Resume 继续；`steer(prompt)` 仍接受新指令并在工具边界放入。

# Model Selection

`session.setModelSelection({ model?, thinkingLevel? })` 在 Session 空闲时原地切换；省略的字段沿用当前选择。返回实际生效的 `{ model, thinkingLevel, clampedFrom? }`，`session.model` 与 `session.thinkingLevel` 提供只读当前值。Thinking Level 取不高于请求档位的最高支持档，没有更低档时取最低支持档；不支持 reasoning 的模型使用 `off`。Run 进行中或另一选择尚未完成时拒绝切换，凭据缺失返回 `no-api-key`，失败不改写选择或用户 settings。

原生 `pi.agent` 是 Model Selection 的恢复来源；模型和档位与 version 2 的 `rukie.model` 镜像在同一事务内保存。Resume 与对话 Rewind 从选中 Conversation 恢复两者，忽略新的 settings 默认档位。version 1 的字符串镜像仍可读取，迁移时用原生 Agent document 的选择补齐档位，不另建恢复来源。

# Goal continuation

[`Goal runtime`](src/tools/goal/runtime.ts) 管理 Goal facts 与已接受的续跑授权，二者分开。真实用户创建或重新开启 Goal 时，Goal document、激活身份、原生 `rukie.goal-driver` task 和因果请求收据在同一事务中提交；只有顶层 Conversation 拥有该 task。driver 保存下一轮 reservation，使用由 task 和 round 组成的稳定 request id 通过原生 inbox 提交输入，等待该轮及相关 child/reporters 的收据，再保留下一轮 reservation。实际输入被原生放置后才增加一次轮次；reservation、Human 输入、Hook continue 和报告不消费轮次。

`createGoal` 返回已接受激活的 `requestId`，第一条输入尚未提交时也能调用 `waitForRequest`。结算包含全部相关轮次及结果处理，以最终回答和不重复的 usage 返回；Human 模型工具创建的激活纳入该 Human 请求，历史目标与无关任务不纳入。`close` 保留已接受 task，重新打开继续同一轮；输入提交确认丢失时重新取得原生 submission 收据。暂停、受阻、完成、上限、清除、显式 abort 或模型错误停止后续 admission，保留已提交事实。暂停或清除不会取消当前工具结果或其回答；未放置的 reservation 不消费轮次。停止状态的重新开启仍需真实用户授权，历史 Goal facts 或终态 task 不构成授权。

Rewind 要求原生任务已结算；fork 按 document 策略保留 Goal facts，但激活 document 使用 initial 策略，原生 tasks 不复制。轮次执行及恢复规则由 [`tools/goal/driver.ts`](src/tools/goal/driver.ts) 拥有；Session 只提供原生提交、因果收据和观测的组合入口。决定见 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)。

# Transcript and context

`Session.messages` 是当前选中对话的完整已提交消息投影，保留 Compaction 前的消息、原始图片和按时间顺序追加的 Compaction notice。原生当前模型上下文从最新 head、摘要、保留尾部和新消息构造，可以排除仍可观察的旧消息；相同内容在保留尾部再次出现时仍然可见。底层 Storage 的公开 entries 和 Conversation 查询保留被 Rewind 放弃的原对话。原生 reset 接收 handoff 并更新上下文 head，既不删除旧 entries，也不清空 Tool State documents；Session 不另外提供一条 reset 执行路径。

状态 reminders 按来源比较当前内容与已持久化贡献，Compaction 后按当前 document 重建；未经确认的提醒不推进模型已知状态。文件变化提醒与最终基线或删除事实同事务提交。冷恢复不保留进程内已读文件内容；检测到变化后要求重读，再允许覆盖。

# Checkpoint and Rewind

`session.checkpoints()` 返回真实人类输入的 entry 锚点。授权后首次 write/edit 最终路径的修改保存原字节或不存在事实，父子共用父级 Checkpoint；bash 与 MCP 副作用不在备份范围。`session.rewind(id, { code, conversation })` 在父子均无活跃原生任务时可用。对话恢复在目标 prompt 之前创建 fork，按 document 策略恢复事实并切换选中对话，保留原历史；后来的 tasks、Goal 激活和子代理活动不复制到新对话。

同时恢复代码与对话时，先验证全部所需备份，再恢复文件，最后发布对话切换。备份缺失时不写文件；实际文件 I/O 失败时不切换对话、不发布恢复快照，但先前成功恢复的文件可能已改变，调用方应检查真实文件状态。只恢复代码保留对话，后续模型请求会获知检测到的文件变化。范围与决定见 [ADR-0017](../../docs/adr/0017-checkpoint-and-branch-rewind.md)和 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)。

# Tool View

工具可声明纯函数 `presentCall` 和 `presentResult`，分别从调用参数及持久化结果事实生成 `@rukie/shared` 的 Tool View。`tool_execution_start` / `tool_execution_end` 携带对应 view，子 Session 事件沿 `subagent_event` 保留它；Headless stream-json 原样输出事件，text 输出行为不变。Presenter 参数或输出不合法、抛错，或工具不可用时，view 为 `undefined`，Frontend 使用原始参数与结果回退显示，呈现失败不影响执行。

View 不写入 Transcript，也不进入模型上下文。`Session.messages` 在读取时重算调用与结果 view；恢复时使用当前内置 presenter，未连接的 MCP 工具没有 view。Presenter 只能读取参数、结果文本及 details，不查询当前文件或运行状态。前台 bash details 保存退出码与信号；write 保存写入前后内容，超过 50 KiB 的文件保存 unified patch，edit 保存实际修改 patch，以便恢复后重算 diff。

# Skills

Agent Core 从用户目录和当前项目的 `.rukie/skills`、`.claude/skills`、`.agents/skills` 发现 `SKILL.md`，项目同名技能覆盖用户技能；无效定义发出警告并跳过。Frontend 可通过 `listSkills({ cwd, homeDir })` 获取用户可调用的名称与描述；`user-invocable: false` 不进入该列表，也不展开 `/name`，但仍可供模型加载。

模型目录只提供技能摘要。条目只包含名称和描述，不包含正文、绝对路径或 `whenToUse`；连续空白合并为单个空格，去掉首尾空白，每条描述最多 500 个字符，超出时保留前 497 个字符并追加 `...`。`disable-model-invocation: true` 的技能不进入模型目录，也不能经 `skill` 工具加载。目录为空或当前工具集没有 `skill` 时，不发布初始目录；子 Session 按自己的工具白名单判断。

模型调用 `skill({ name })` 才收到完整正文及文件位置、相对引用基准；工具调用照常受权限和 Hook 约束。用户在 prompt 开头直接输入 `/name` 时，程序保留原 prompt，并将正文作为 `skill-invocation` System Reminder 注入，提醒模型正文已提供、不要再次调用 `skill` 加载。这仍可调用禁止模型主动加载的技能；未知名称和 `user-invocable: false` 保持普通文字。

目录的规范化条目经过摘要比较，历史只取原生当前模型上下文中仍可见的技能目录。条目未变就不追加，正文、文件路径或被截掉的描述尾部变化不导致目录更新；可见条目改变时发布完整替换目录，明确停用旧名单，最后一个条目移除时发布空替换。Compaction 后目录已不再可见时重新发布，仍可见时复用；Resume 与 Rewind 使用各自当前分支的可见上下文，不保存另一个进程内“已发布”状态。

# Context Usage

`session.contextUsage()` 同步返回当前模型上下文的占用及分段快照，不发起模型请求、不写入 Transcript。总占用采用最近一轮 provider 输入计数（含 cacheRead 与 cacheWrite），Session Resume 从恢复的当前上下文读取该计数；没有输入计数时按当前上下文估算。分段始终为估算值，其中 tools 包含当前内置和 MCP 工具定义，以及工具返回内容；已被移除或替换的定义不重复计入。Compaction、Rewind 或模型切换使旧计数失效，随后恢复估算，直到收到新回复。Frontend 可在恢复视图时读取该快照，并继续消费 `context_usage` 事件更新预览。分类报告使用 `session.contextReport()`，采用相同的总占用计数。

# Run summary

公开 `run()` 的 `result` 携带执行时长 `durationMs`；完成时间 `endedAt` 保存在对应摘要事实中。Session 在完成边界保存独立的 `run-summary` 自定义条目，记录时长、完成时间、成功状态及消息边界；元数据不进入模型上下文。`session.runSummaries()` 返回当前恢复上下文中可定位的摘要，`afterMessage` 是 `Session.messages` 中一基消息位置。Frontend 在该消息后绘制摘要；Compaction 保留完整 Transcript 与可定位摘要，Rewind 的选中分支仅显示 cutoff 内的摘要。旧历史没有完成记录时不推算耗时；非法记录忽略，摘要提交失败向调用方传播实际存储错误。

TUI 在每个结束的 Run 消息底部显示摘要，完成时间使用本地时区。成功显示完成，失败或中断显示结束；摘要不参与消息选择或复制。实时结束与 Resume 使用同一记录语义。

# Background Job

Session 持有一个 registry；所有 bash 使用同一条进程组启动路径。前台记录对模型不可见，在超时前完成后移除；`run_in_background: true` 返回 `started background job bash-N`，工具结果的 `details.jobId` 保留关联。前台超时返回 `[still running after <s>s; moved to background job bash-N]` 和后台操作说明，同样带 `details.jobId`，进程继续运行；此前已显示的输出不在后续 `job_output` 中重复。每个 Session 的后台任务处于 running 或 stopping 的数量达到 10 时，拒绝新的显式后台启动；超时转后台不受该上限限制。前台调用被取消会终止进程，后台任务在 Run 结束或取消后继续运行；Session Resume 创建空 registry。

`job_list` 列出当前 Session 的后台任务。`job_output { job_id, wait?, timeout_ms? }` 消费模型游标之后的 stdout，再返回独立的 `[stderr]` 段与状态行；没有新输出时显示 `(no new output)`。`wait` 等待新输出或完成，默认 30 秒，最长 10 分钟；取消等待不杀进程、不移动游标。完成后的 `wait` 收集和模型 `job_kill` 会标记结束通知已被抑制。未知 id 的错误说明后台任务不跨 Session 重启。这三个工具直接通过 Permission Mode，仍经过权限规则与 hooks；bash 的后台参数沿用普通 bash 的授权路径。

后台任务完成后，Session 将 `background job <id> (bash: <label>) finished [status: …]. Read its output with job_output.` 提交为原生会话输入。正在运行时通知追加到当前上下文，供后续模型请求读取；空闲时提交 follow-up，开启内部 Run。使用 `session.subscribe` 观察跨 Run 的任务通知。新输出不触发通知，父 Run 不等待后台任务；完成后的 `wait` 收集、模型停止和 teardown 抑制通知，取消等待仍保留通知资格。内部通知不触发 `UserPromptSubmit`。

Frontend 使用 `session.jobs()` 获取本 Session 的后台任务快照，包括已结束的记录；`session.readJob(id, offset)` 从 stdout 与 stderr 共用的绝对 UTF-8 字节偏移读取，返回 `stdout`、`stderr`、`nextOffset`、`dropped`，不消费模型游标。首次读取传 `0`，后续增量读取传上次 `nextOffset`；多个观察者分别保存自己的偏移。偏移必须是非负安全整数；未知 id 报错。`JobView`、`JobOutput`、`JobEvent` 由 `@rukie/shared` 定义，`@rukie/agent` 同时导出。

`session.subscribe` 在 Run 内外接收 `job_event`：显式后台启动或超时转后台时发送 `started`；输出按约 150 ms 合并发送 `output`，事件只带任务视图，Frontend 用 `readJob` 拉取内容；最终输出先发送，再发送 `settled`。前台任务不可见，也不发事件。活跃 Run 的 `onEvent` 同样接收这些事件；输出观察者不阻塞进程 drain，可以在回调中 await `session.close()`。普通 bash 工具结果的 `details.jobId` 将当前 registry 的任务关联到发起调用，恢复时不凭历史结果重建任务。恢复后的编号从已保存的 bash 调用和结果继续，扫描包括 compaction 和 Rewind 的历史；缺少结果或未获授权的调用可以留下编号空隙。

`await session.killJob(id)` 请求终止后台任务，先抑制结束通知，再发送信号；重复停止或停止已结束任务是 no-op。正在执行 Run 时，`User stopped background job <id> (<label>).` 作为 steer 输入交给模型；空闲时消息排队到下一条人类 prompt 前，不唤醒模型。尚未投递的停止消息在取消 Run 后仍保留。Headless CLI 原样输出 stream-json 任务事件，text 只输出正常结果；普通 prompt 或 Goal 的因果请求结算后调用 `session.close()`，终止所有后台任务。

stdout 与 stderr 分别保存在带绝对字节偏移的内存 ring，合计保留 256 KiB；任务结束后合计保留 16 KiB，始终在 UTF-8 字符边界截断。完整原始输出写入 Session 专属的 0700 临时目录，日志权限为 0600。发生内存丢弃时，模型输出附带完整日志路径。宿主关闭移除这些输出资源；恢复后仍能读取已提交的工具结果文本和 details，历史路径不表示日志文件仍存在。

子 Session 拥有独立 registry 与 10 个后台任务名额，`job_*` 只操作自己的任务，完成通知只交给子模型；`job_event` 沿现有 `subagent_event` 转给父观察者，父 `jobs()` 与 `job_list` 不含子任务。子 Run 成功、失败或中止时，在发布 `result` 与解除运行占用前清理自己的任务；父任务继续运行。清理不发送任务事件、结束通知或唤醒输入，`send_message` 续跑同一子 Session 时旧任务 id 已不存在，新编号继续递增。

`clear()` 终止任务、移除输出记录与目录，registry 可继续用于子 Run；`dispose()` 永久关闭 registry。清理先抑制全部任务的结束通知，子 Session 清理还关闭输出与事件回调；普通 `session.close()` 保留任务结束事件。随后向拥有的进程组发 SIGTERM，3 秒后升级 SIGKILL，输出 drain 最长 3.1 秒；并发清理共用一次收束。进程 `exit` 回调同步向所有仍活跃的进程组发 SIGKILL；自行脱离进程组的后代不在终止范围内，清理会断开它继承的输出管道以避免挂起。前台 shell 已完成但仍活跃的同组后代也保留清理归属。

工具执行使用原生 ToolRegistration。bash、文件操作、web fetch 与 MCP 工具采用 unsafe replay；工具结果提交前发生中断时，恢复记录未知结果，不重新执行副作用。MCP 的 read-only 或 idempotent 提示不改变该策略，当前配置也不能把已提交的 unsafe intent 变成 safe。Job 属于宿主 OS 资源，不是 durable Task；恢复不会重建旧进程或当前 Job 列表。

# Subagent observation

`session.readSubagent(id)` 返回当前父 Session 所属子 Session 的只读快照：真实顺序的消息、模型、描述与最近一次 `SubagentRun`。它在父级已打开的同一原生 Storage 中核对目录和 ownership，读取已提交事实，不为子代理另开存储租约、不创建 Session、不修复存储、不发起 Run。未知或不属于父 Session 的 id 返回 `undefined`，读取失败拒绝 Promise。

快照的 `historyMessages` 在最近 Run 的原生开始事实存在时，提供该事实之前的已提交上下文；它由 Transcript 条目顺序重建，排除当前 Run 的所有 Turn。Frontend 将这段旧历史与已观察到的当前事件各呈现一次；provider 消息 timestamp 不用于判定 Run 归属。原生 Unknown Tool Outcome 保留未知状态，不能由 `isError=false` 推断成功。

子 Run 保存实际模型、`RunResult.durationMs` 和 `usage.totalTokens`，历史缺少的可选字段保持缺失。Run Outcome 表示这次运行的结束原因，委派任务是否完成由父代理判断；无当前活动不代表成功。恢复与归属规则见 [ADR-0009](../../docs/adr/0009-subagent-resume-outcomes.md)。

后台 Subagent 使用持久化 driver 与 owned Conversation，父级普通 `run` 可先返回；`abort` 不取消后台 child。`close` 关闭当前 invocation 和 OS／连接资源，未结算 child 与 reporter 在重开时继续。已结束或明确取消的 driver 不重新创建；Run Outcome 仍不代表父级已验收委派任务。`subagent` 创建新身份，`subagent_fork` 继承已完成 Turn；`send_message` 向原 child 发送，活动时 steer，空闲时启动新的 child Run。子代理不能递归委派，类型、当前权限、MCP 过滤、共享 Plan Mode 与 Interaction 来源继续生效。

新建的非 fork 子代理未显式指定模型时，继承父 Session 当前的模型与 Thinking Level；类型 `model` 优先于 `settings.subagentModel`，两者显式指定模型时从 `settings.thinking` 默认档位按子模型的支持范围向下降档。`subagent_fork` 保持原有选择规则；retained 子代理通过 `send_message` 续跑时恢复自己保存的模型与档位，不应用父级当前选择或新的 settings 默认值。

`await session.interruptSubagent(id)` 取消所选活动 child 的 ownership，并等待原生 driver 终态，包括其取消通知处理；不影响 sibling。已结算 child 为 no-op；child 已停止但 reporter 未结算时，重复停止仍等待同一终态，不重复改变 Run Outcome。未知 id 拒绝 Promise。Frontend 不等待停止时也须处理该 Promise 的失败。存储或关闭错误会传播，不把请求取消标记当作已停止。

`session.currentRequestId` 是产品请求身份；`await session.waitForRequest(id)` 等待该请求已接受的 root 输入、相关 child Run、reporter 与通知引发的后续处理。它沿已提交原生 ownership 和 ToolTask／Submission 身份收敛因果范围，处理后来新增的相关 child；向已有活动 child 发送消息的请求也等待该 driver 与报告处理。空闲 anchor、历史 child 与无关运行不属于该范围。`SubagentRun.id` 是 driver task id，provider 的 tool call id 和 SDK `StreamOptions.sessionId` 都不是产品请求 id。SDK Session 身份由原生 Conversation 持久化，重试和恢复沿用；新 fork 获得独立身份。

child 结束事实、稳定 reporter 输入和父级回答分别提交。恢复 child done、reporter pending 或父级处理未结算的窗口，复用相同逻辑身份，不重复输入或重建已结束 child；重试可能再次调用模型，不能据此承诺网络请求或外部副作用 exactly-once。原始消息、已提交工具进度与未知结果保留，子视图及来源事件采用已提交事实。

# Application identity

Frontend 创建 Session 时通过 `SessionOptions.applicationVersion` 注入自身产品版本。Agent Core 不读取 Frontend manifest；父 Session 与子 Session 的 web_fetch 使用 `Rukie/<version>` User-Agent，MCP 初始连接、重连及 OAuth 后连接使用同一版本。该身份不写入 Transcript，Resume 使用当前宿主传入的版本。未提供版本的嵌入宿主使用 `Rukie` User-Agent 和 MCP `unversioned` 身份；coding-agent 总是提供自身 manifest 版本。模型 provider 的协议与 SDK 身份继续由锁定 pi-ai 管理。

# grep runtime resource

源码运行经 `@vscode/ripgrep` 的锁定平台包定位 rg。npm 编译产物由 release builder 的 `RUKIE_COMPILED` 常量选择平台执行文件 `realpath(process.execPath)` 同目录的 `rg`，避免 Bun 虚拟源码路径和用户 cwd 影响定位；二者使用同一 grep 工具和权限路径。缺失或不可执行的资源返回 `ripgrep-unavailable`；编译产物提示平台包不完整和重新安装 optionalDependencies。分发资源与验收见[构建教程](../../docs/release-building.md)。

## 模型目录

`await listModelCatalog(settings)` 返回内置与自定义 provider 的全部已知聊天模型，以及 provider 显示名、输入能力、reasoning、支持的 Thinking Level、context window、自定义来源和本地凭据是否配置的事实。目录不刷新模型、不刷新 OAuth，也不发送模型请求；无凭据模型仍保留，由 Frontend 决定显示哪些 provider。每次调用重新检测凭据，失败向调用方传播；目录不会改写 settings 或 Session。
