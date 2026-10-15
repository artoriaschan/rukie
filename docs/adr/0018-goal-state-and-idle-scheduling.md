---
status: accepted
---

# Goal 持久化目标事实，自动续跑只由当前进程显式开启

本决定的进程内 armed、Resume 不续跑及旧 idle scheduler 由新决定部分替代；真实用户授权、目标事实、暂停/受阻/完成/上限与轮次义务继续有效。替代关系见 [ADR-0024](0024-adopt-pi-durable-harness.md)。下文记录被部分替代的历史决定；当前续跑与恢复契约见 [Agent README](../../packages/agent/README.md#goal-continuation)。

## 问题

跨 Run 的目标需要延续进度；恢复历史目标却自动重新执行，可能在用户没有再次授权时重复副作用。自动续跑也不能抢占用户输入或忽略停止原因。

## 决定

Goal 以 version 2 Tool State 保存目标文本、目标消息图片数量、阶段、轮次、受阻原因与已结算执行时长，清除时写空值快照；不迁移 version 1。Frontend 通过唯一的 `createGoal` 入口提交一条可见的人类目标消息，包含文本与图片（至少一项），作为计入轮次的第 1 轮输入；图片不写入 Tool State。第 2 轮起继续使用隐藏的内部 Goal round。模型工具 `create_goal` 仍只接受文本并沿用内部 round。是否 armed、正在自动续跑属于当前进程；Resume 和对话 Rewind 恢复目标事实但保持未开启。只有顶层 Session 拥有 Goal，子代理不创建独立自动调度。

创建、修改目标或重新开启已暂停目标需要真实用户授权。内部 Goal prompt 不能自行生成新的授权；模型可以报告目标完成或受阻。Goal 与 Todo 分别表达跨 Run 目标和 Session 任务清单。

执行时长累计推进期间的墙钟时间，包括权限和问题等待。每轮结束及暂停、受阻、停止、出错、完成、清除、上限边界结算 `activeSince` 到当前时刻的时长，继续推进则开启新段；`activeSince` 只在 armed 时存在。恢复已接受 task 时丢弃未结算历史段，从当前时刻开启新段，停机时间不计入；Fork 复制已结算 `elapsedMs` 并清除活动段，Rewind 恢复锚点时的时长；首条目标消息携带创建前的 Goal 事实，回退到该消息之前恢复旧值，避免只发图片的目标脱离附件消息。

自动轮次只在 Session 空闲并完成 Stop 与已有唤醒处理后开始，真实用户队列优先。只有实际 Goal 轮次增加计数，用户 Run、hook 续跑和内部通知不计入。中止、错误和轮次耗尽停止自动调度，保留目标事实；调度不扩大权限。

扩展的目标消息与时长合同见[桌面目标模式规格](../../.scratch/desktop-goal-mode/spec.md)；原始依据：[Goal 规格](../../.scratch/goal/spec.md)。状态恢复见 [ADR-0016](0016-tool-state-and-context-projection.md)，内部续跑沿用 [Checkpoint 锚点](0017-checkpoint-and-branch-rewind.md)。

## 备选方案

- 持久化自动续跑开关并在 Resume 自动启动：用户打开历史 Session 就会触发执行，违反显式恢复约束。
- 让模型在内部续跑中创建或重新开启 Goal：内部指令形成自授权循环。

## 影响

Frontend 必须区分“存在未完成目标”和“当前正在自动续跑”，并按已结算时长与活动段呈现时间。人类目标消息使用普通图片准入、标题、Checkpoint 与可见对话路径，后续内部 round 保留隐藏来源。调度需要处理用户输入、hook 和子代理通知的先后关系；Goal 完成由结果判定，不能以当前没有活动代替。
