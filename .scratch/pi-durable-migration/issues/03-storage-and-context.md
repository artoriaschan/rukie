# 03: 原生 JSONL、documents、上下文与 Rewind

Status: ready-for-agent
Blocked by: 02

## What to build

把 Session Store、状态与上下文接入原生 durable Storage。建立新目录/索引、单宿主访问、fsync 和持久化身份；按能力声明 document 历史与 fork 策略。迁移 Transcript 投影、reminders、Compaction、Checkpoint/Rewind 和文件基线事务，不再读取旧 session repo 或旧 Tool State 消息。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [ ] 新建、枚举、按 id 打开仅消费新目录及索引；旧 Session 文件保持原样且不进入 picker，旧 id 返回明确失败，不执行自动导入/升级。
- [ ] 原生 JSONL sidecars、父子 ownership 与索引可跨 close/reopen恢复，启用 fsync；重复进程打开同一 storage 被宿主拒绝，失效持有者可恢复，不存在误删活持有者的清理。
- [ ] Typed documents 覆盖 Todo、Goal facts、Plan Mode、模型选择、子代理、Checkpoint 和文件跟踪；清空、版本校验、坏状态处理及 latest/rewindable/fork 策略有明确行为。
- [ ] 原生 reset/fork/Compaction 和状态 reminders 构造可恢复模型上下文；保留完整历史并区分当前上下文，提醒去重不依赖旧 Branch API。
- [ ] 文件变更提醒与基线/删除事实原子提交，提交失败不推进模型已知状态、不发布成功事件；Resume 要求重读的保守行为保留。
- [ ] Checkpoint 保留真实输入锚点、授权后首次 write/edit 备份与父级归属；Rewind 原历史保留、documents 恢复，文件恢复失败不切换对话。
- [ ] 父子有活跃工作时拒绝 Rewind；恢复位置不复制后来的 task/Goal/subagent 活动，原历史中的图片与消息仍可观察。
- [ ] 列表、预览和只读查询不启动模型或原生 scheduler；存储失败、退出与关闭有有界收束，原生 storage 资源不跨调用泄漏。

## Testing Decisions

优先经 createSession 验证 reopen、Compaction、documents、模型请求内容、文件副作用和 Rewind；沿用 checkpoint、checkpoint-subagents、文件变更与恢复 prior art。真实提交失败通过受控 Storage 故障注入并观察公开错误与重新打开状态，不写镜像内部快照测试。跨进程独占使用真实第二进程和退出信号。

## Verification

尚未实施。执行时追加实际命令、退出码、公开行为证据、focused timing 与未验证范围；不得用文档检查冒充代码验收。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。
