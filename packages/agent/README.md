# Background Job

Session 持有一个 registry；所有 bash 使用同一条进程组启动路径。前台记录对模型不可见，在超时前完成后移除；`run_in_background: true` 返回 `started background job bash-N`，工具结果的 `details.jobId` 保留关联。前台超时返回 `[still running after <s>s; moved to background job bash-N]` 和后台操作说明，同样带 `details.jobId`，进程继续运行；此前已显示的输出不在后续 `job_output` 中重复。每个 Session 的后台任务处于 running 或 stopping 的数量达到 10 时，拒绝新的显式后台启动；超时转后台不受该上限限制。前台调用被取消会终止进程，后台任务在 Run 结束或取消后继续运行；Session Resume 创建空 registry。

`job_list` 列出当前 Session 的后台任务。`job_output { job_id, wait?, timeout_ms? }` 消费模型游标之后的 stdout，再返回独立的 `[stderr]` 段与状态行；没有新输出时显示 `(no new output)`。`wait` 等待新输出或完成，默认 30 秒，最长 10 分钟；取消等待不杀进程、不移动游标。完成后的 `wait` 收集和模型 `job_kill` 会标记结束通知已被抑制。未知 id 的错误说明后台任务不跨 Session 重启。这三个工具直接通过 Permission Mode，仍经过权限规则与 hooks；bash 的后台参数沿用普通 bash 的授权路径。

后台任务完成后，Session 通过现有 rewake 通道向模型发送 `background job <id> (bash: <label>) finished [status: …]. Read its output with job_output.`。正在运行时通知进入下一次模型请求；空闲时通知开启内部 Run，并保留上次 Run 的 observer。新输出不触发通知，父 Run 不等待后台任务；完成后的 `wait` 收集、模型停止和 teardown 抑制通知，取消等待仍保留通知资格。内部通知不触发 `UserPromptSubmit`。

stdout 与 stderr 分别保存在带绝对字节偏移的内存 ring，合计保留 256 KiB；任务结束后合计保留 16 KiB，始终在 UTF-8 字符边界截断。完整原始输出写入 Session 专属的 0700 临时目录，日志权限为 0600。发生内存丢弃时，模型输出附带完整日志路径。内部 `read(offset)` 不消费模型游标。

`clear()` 终止任务、移除输出记录与目录，registry 可继续用于子 Run；`dispose()` 永久关闭 registry。清理先向拥有的进程组发 SIGTERM，3 秒后升级 SIGKILL，输出 drain 最长 3.1 秒。进程 `exit` 回调同步向所有仍活跃的进程组发 SIGKILL；自行脱离进程组的后代不在终止范围内，清理会断开它继承的输出管道以避免挂起。前台 shell 已完成但仍活跃的同组后代也保留清理归属。
