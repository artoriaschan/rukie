# 07: Goal 续跑改为可恢复的原生任务

Status: ready-for-agent
Blocked by: none

## What to build

保留 Goal 产品能力与状态边界，把活跃自动续跑表达为持久化原生任务/提交，移除独立进程 armed/idle scheduler。目标恢复只能继续已接受的工作，不因为一条历史目标事实建立新执行授权。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [ ] 活跃 Goal 任务 close/reopen 后恢复，round 输入使用稳定身份；轮次计数与相关提交/终态关联，恢复不重复计数或重复创建 prompt。
- [ ] 暂停、受阻、完成、轮次耗尽、清除和显式取消的目标保持停止；重新开启仍需真实用户授权，模型内部续跑不自授权。
- [ ] 用户输入、Hook continue 与通知沿原生 inbox/任务调度，不再维护另一套模型循环；既有 maxRounds 与错误/停止义务明确，不能越限。
- [ ] 只有顶层 Session 拥有 Goal；Todo 与 Goal 分开，子 fork 不继承可执行的父 Goal 任务，Rewind 不复制后来自动续跑。
- [ ] Goal 文案、状态查询与事实事件使用持久化状态及原生任务观测，不能把“有目标”或“父 idle”当成当前在续跑。
- [ ] Headless --goal 的请求范围包含相关后台结果处理；完成、失败、暂停、上限和主动中断能产生明确退出结果，不永久等待空闲 anchor。

## Testing Decisions

公开 createSession 验证每个状态与 round boundary，复用 Goal/Goal tools 与 async Hook prior art。控制提交前后、round结束后续输入前及 child reporter 阶段重启，断言实际模型输入数/状态/预算而非 scheduler 私有字段。少量 Frontend smoke 在 08 验证。

## Verification

尚未实施。执行时追加实际命令、退出码、公开行为证据、focused timing 与未验证范围；不得用文档检查冒充代码验收。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。
