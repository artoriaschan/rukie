# bash 工具改为自研，以支持 Background Job

Status: accepted

ADR-0002 复用 pi 的 bash 工具，但 pi 的 `NodeExecutionEnv.exec` 会一直等到进程退出才返回，不能在工具调用返回后让进程继续运行，也不能在超时时把进程转入后台。照 deepseek-harness 的做法，每条 bash 命令从启动起就登记为一个 Background Job，前台调用只是等待它结束；因此改为 Agent Core 自研 bash 工具和 spawn 逻辑。仍复用 pi 的截断与输出采集工具函数，其余 pi 工具（read/write/edit）继续复用。

## Considered Options

- 前台保留 pi bash，后台另写一套：前后台各有一条执行路径，超时转后台时还要把进程从 pi 的执行路径交接给自研的那一套。
