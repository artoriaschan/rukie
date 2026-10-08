---
status: accepted
---

# bash 工具改为自研，以支持 Background Job

本决定的宿主退出和子 Run 收尾协调由新决定部分替代；自研 bash、OS Background Job ownership、进程清理与 Resume 不重建进程继续有效。替代关系见 [ADR-0024](0024-adopt-pi-durable-harness.md)。下文记录被部分替代的历史决定；当前契约见 [Agent README](../../packages/agent/README.md#background-job)，整体交付验收见[规格与票据](../../.scratch/pi-durable-migration/spec.md)。

## 问题

pi 的前台 bash 执行路径无法在工具返回后保留进程，也无法将超时进程转入后台。

## 决定

ADR-0002 复用 pi 的 bash 工具，但 pi 的 `NodeExecutionEnv.exec` 会一直等到进程退出才返回，不能在工具调用返回后让进程继续运行，也不能在超时时把进程转入后台。照 deepseek-harness 的做法，每条 bash 命令从启动起就登记为一个 Background Job，前台调用只是等待它结束；因此改为 Agent Core 自研 bash 工具和 spawn 逻辑。仍复用 pi 的截断与输出采集工具函数，其余 pi 工具（read/write/edit）继续复用。

### 资源与通知

Background Job registry 归 Session，进程组从启动起共用一条执行路径；显式后台启动或超时提升只改变等待方式，不交接到另一套执行器。普通 Session 的 Run 结束不终止后台任务，Session dispose 才释放进程与输出；Headless 在请求或 Goal 结束后 dispose。子 Run 在发布结果前清理自己的任务，不留下可以继续唤醒父级的旧进程。

Job 是当前进程资源，不保存为 Tool State；Resume 不重建进程。模型增量输出游标与 Frontend 的绝对偏移读取独立，前端查看不会消耗模型尚未读取的输出。任务结束通知进入现有 steer、rewake 路径，输出流本身不启动 Run；用户在空闲时停止任务，由下一条真实 prompt 告知模型。

`job_list`、`job_output`、`job_kill` 只管理本 Session 已授权的进程，不重复请求审批；仍经过输入校验、hooks、规则 deny 和取消处理。完整协议由 [Agent README](../../packages/agent/README.md)维护，依据见[后台任务规格](../../.scratch/background-jobs/spec.md)。

## 备选方案

- 前台保留 pi bash，后台另写一套：前后台各有一条执行路径，超时转后台时还要把进程从 pi 的执行路径交接给自研的那一套。

## 影响

Agent Core 维护进程启动、输出和取消逻辑；所有前后台进程共用 Background Job 生命周期。调用方必须在正确的 Session 或子 Run 边界完成资源释放；Transcript 保留历史工具事实，但不表示后台进程仍然存在。
