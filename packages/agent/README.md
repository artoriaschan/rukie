# Tool View

工具可声明纯函数 `presentCall` 和 `presentResult`，分别从调用参数及持久化结果事实生成 `@neant/shared` 的 Tool View。`tool_execution_start` / `tool_execution_end` 携带对应 view，子 Session 事件沿 `subagent_event` 保留它；Headless stream-json 原样输出事件，text 输出行为不变。Presenter 参数或输出不合法、抛错，或工具不可用时，view 为 `undefined`，Frontend 使用原始参数与结果回退显示，呈现失败不影响执行。

View 不写入 Transcript，也不进入模型上下文。`Session.messages` 在读取时重算调用与结果 view；恢复时使用当前内置 presenter，未连接的 MCP 工具没有 view。Presenter 只能读取参数、结果文本及 details，不查询当前文件或运行状态。前台 bash details 保存退出码与信号；write 保存写入前后内容，超过 50 KiB 的文件保存 unified patch，edit 保存实际修改 patch，以便恢复后重算 diff。

# Background Job

Session 持有一个 registry；所有 bash 使用同一条进程组启动路径。前台记录对模型不可见，在超时前完成后移除；`run_in_background: true` 返回 `started background job bash-N`，工具结果的 `details.jobId` 保留关联。前台超时返回 `[still running after <s>s; moved to background job bash-N]` 和后台操作说明，同样带 `details.jobId`，进程继续运行；此前已显示的输出不在后续 `job_output` 中重复。每个 Session 的后台任务处于 running 或 stopping 的数量达到 10 时，拒绝新的显式后台启动；超时转后台不受该上限限制。前台调用被取消会终止进程，后台任务在 Run 结束或取消后继续运行；Session Resume 创建空 registry。

`job_list` 列出当前 Session 的后台任务。`job_output { job_id, wait?, timeout_ms? }` 消费模型游标之后的 stdout，再返回独立的 `[stderr]` 段与状态行；没有新输出时显示 `(no new output)`。`wait` 等待新输出或完成，默认 30 秒，最长 10 分钟；取消等待不杀进程、不移动游标。完成后的 `wait` 收集和模型 `job_kill` 会标记结束通知已被抑制。未知 id 的错误说明后台任务不跨 Session 重启。这三个工具直接通过 Permission Mode，仍经过权限规则与 hooks；bash 的后台参数沿用普通 bash 的授权路径。

后台任务完成后，Session 通过现有 rewake 通道向模型发送 `background job <id> (bash: <label>) finished [status: …]. Read its output with job_output.`。正在运行时通知进入下一次模型请求；空闲时通知开启内部 Run，并保留上次 Run 的 observer。新输出不触发通知，父 Run 不等待后台任务；完成后的 `wait` 收集、模型停止和 teardown 抑制通知，取消等待仍保留通知资格。内部通知不触发 `UserPromptSubmit`。

Frontend 使用 `session.jobs()` 获取本 Session 的后台任务快照，包括已结束的记录；`session.readJob(id, offset)` 从 stdout 与 stderr 共用的绝对 UTF-8 字节偏移读取，返回 `stdout`、`stderr`、`nextOffset`、`dropped`，不消费模型游标。首次读取传 `0`，后续增量读取传上次 `nextOffset`；多个观察者分别保存自己的偏移。偏移必须是非负安全整数；未知 id 报错。`JobView`、`JobOutput`、`JobEvent` 由 `@neant/shared` 定义，`@neant/agent` 同时导出。

`session.subscribe` 在 Run 内外接收 `job_event`：显式后台启动或超时转后台时发送 `started`；输出按约 150 ms 合并发送 `output`，事件只带任务视图，Frontend 用 `readJob` 拉取内容；最终输出先发送，再发送 `settled`。前台任务不可见，也不发事件。活跃 Run 的 `onEvent` 同样接收这些事件；输出观察者不阻塞进程 drain，可以在回调中 await `dispose()`。普通 bash 工具结果的 `details.jobId` 将当前 registry 的任务关联到发起调用，恢复时不凭历史结果重建任务。恢复后的编号从已保存的 bash 调用和结果继续，扫描包括 compaction 和 Rewind 的历史；缺少结果或未获授权的调用可以留下编号空隙。

`await session.killJob(id)` 请求终止后台任务，先抑制结束通知，再发送信号；重复停止或停止已结束任务是 no-op。正在执行 Run 时，`User stopped background job <id> (<label>).` 作为 steer 输入交给模型；空闲时消息排队到下一条人类 prompt 前，不唤醒模型。尚未投递的停止消息在取消 Run 后仍保留。Headless CLI 原样输出 stream-json 任务事件，text 只输出正常结果；普通 prompt 或 Goal 结束后调用 Session dispose，终止所有后台任务。

stdout 与 stderr 分别保存在带绝对字节偏移的内存 ring，合计保留 256 KiB；任务结束后合计保留 16 KiB，始终在 UTF-8 字符边界截断。完整原始输出写入 Session 专属的 0700 临时目录，日志权限为 0600。发生内存丢弃时，模型输出附带完整日志路径。

子 Session 拥有独立 registry 与 10 个后台任务名额，`job_*` 只操作自己的任务，完成通知只交给子模型；`job_event` 沿现有 `subagent_event` 转给父观察者，父 `jobs()` 与 `job_list` 不含子任务。子 Run 成功、失败或中止时，在发布 `result` 与解除运行占用前清理自己的任务；父任务继续运行。清理不发送任务事件、结束通知或唤醒输入，`send_message` 续跑同一子 Session 时旧任务 id 已不存在，新编号继续递增。

`clear()` 终止任务、移除输出记录与目录，registry 可继续用于子 Run；`dispose()` 永久关闭 registry。清理先抑制全部任务的结束通知，子 Session 清理还关闭输出与事件回调；普通 Session dispose 保留任务结束事件。随后向拥有的进程组发 SIGTERM，3 秒后升级 SIGKILL，输出 drain 最长 3.1 秒；并发清理共用一次收束。进程 `exit` 回调同步向所有仍活跃的进程组发 SIGKILL；自行脱离进程组的后代不在终止范围内，清理会断开它继承的输出管道以避免挂起。前台 shell 已完成但仍活跃的同组后代也保留清理归属。

# Subagent observation

`session.readSubagent(id)` 返回当前父 Session 所属子 Session 的只读快照：按真实消息顺序的 `PresentedMessage`、可获得的模型，以及最近一次 `SubagentRun`。活跃子 Session 从内存读取；已卸载子 Session 经 `SessionStore.find/openReadonly` 核对工作目录与父子归属后读取 main 分支，并在完成或失败时关闭句柄。未知或不属于父 Session 的 id 返回 `undefined`；缺少只读存储能力或读取失败时拒绝 Promise。读取不创建 Session、不修复存储、不发起 Run，也不改变模型或权限。

子 Run 保存实际模型、`RunResult.durationMs` 和 `usage.totalTokens`，历史缺少的可选字段保持缺失。Run Outcome 表示这次运行的结束原因，委派任务是否完成由父代理判断；无当前活动不代表成功。恢复与归属规则见 [ADR-0009](../../docs/adr/0009-subagent-resume-outcomes.md)。
