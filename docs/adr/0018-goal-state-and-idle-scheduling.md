---
status: accepted
---

# Goal 持久化目标事实，自动续跑只由当前进程显式开启

本决定的进程内 armed、Resume 不续跑及旧 idle scheduler 由新决定部分替代；真实用户授权、目标事实、暂停/受阻/完成/上限与轮次义务继续有效。替代关系见 [ADR-0024](0024-adopt-pi-durable-harness.md)。新决定已接受，实施尚未开始；下文记录迁移前义务，当前进度见[规格与票据](../../.scratch/pi-durable-migration/spec.md)。

## 问题

跨 Run 的目标需要延续进度；恢复历史目标却自动重新执行，可能在用户没有再次授权时重复副作用。自动续跑也不能抢占用户输入或忽略停止原因。

## 决定

Goal 以 Tool State 保存目标、阶段、轮次与受阻原因，清除时写空值快照。是否 armed、正在自动续跑属于当前进程；Resume 和对话 Rewind 恢复目标事实但保持未开启。只有顶层 Session 拥有 Goal，子代理不创建独立自动调度。

创建、修改目标或重新开启已暂停目标需要真实用户授权。内部 Goal prompt 不能自行生成新的授权；模型可以报告目标完成或受阻。Goal 与 Todo 分别表达跨 Run 目标和 Session 任务清单。

自动轮次只在 Session 空闲并完成 Stop 与已有唤醒处理后开始，真实用户队列优先。只有实际 Goal 轮次增加计数，用户 Run、hook 续跑和内部通知不计入。中止、错误和轮次耗尽停止自动调度，保留目标事实；调度不扩大权限。

依据：[Goal 规格](../../.scratch/goal/spec.md)。状态恢复见 [ADR-0016](0016-tool-state-and-context-projection.md)，内部续跑沿用 [Checkpoint 锚点](0017-checkpoint-and-branch-rewind.md)。

## 备选方案

- 持久化自动续跑开关并在 Resume 自动启动：用户打开历史 Session 就会触发执行，违反显式恢复约束。
- 让模型在内部续跑中创建或重新开启 Goal：内部指令形成自授权循环。

## 影响

Frontend 必须区分“存在未完成目标”和“当前正在自动续跑”。调度需要处理用户输入、hook 和子代理通知的先后关系；Goal 完成由结果判定，不能以当前没有活动代替。
