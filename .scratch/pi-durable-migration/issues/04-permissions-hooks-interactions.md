# 04: 权限、Hook 协议与中断交互恢复

Status: ready-for-agent
Blocked by: 03

## What to build

将 Permission Decision/Review、Trusted Project、Claude Code Hook 协议及 Interaction 接入原生工具与 generation 生命周期。设计最小宿主扩展保存请求阶段并恢复未完成交互，使用当前配置重新判定，失效进程内回调不能影响恢复后的任务。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [ ] 工具先校验输入，再按现有 Hook/显式权限规则/模式/Frontend 判定执行；Hook allow 越不过 deny，改写后的参数仍重新授权。
- [ ] 当前项目信任、用户与项目配置边界和 Permission Review 失败转 ask 保留；恢复后的 safe 工具也不得跳过当前规则。
- [ ] 权限、问题、Plan Review 与 MCP OAuth 的未完成请求有可恢复的身份/阶段；close/reopen 后重新判定并重新发起，不把关闭保存为批准/拒绝或业务工具成功。
- [ ] 临时 allow 不恢复，旧 callback 晚到无效；显式拒绝/abort 后任务不因重开又恢复等待同一被取消请求。
- [ ] Headless 缺少回调时依赖交互的工具隐藏，Core 发起的请求取安全默认，不等待不可达 Frontend。
- [ ] Claude Code Hook 事件、输入、输出、取消、Stop 继续与日志语义对应 durable 生命周期；外部 Hook 副作用不自动声明 replay-safe，不承诺重启下 exactly-once。
- [ ] Plan Mode 独立于权限，不采用上游示例的强制只读模式；父子共享规划状态和来源转发/排队行为保留。

## Testing Decisions

公开 Session 测试覆盖交互挂起时 close、规则/信任变更后 reopen、旧回复晚到、deny、safe replay 当前授权以及无 callback。复用 permission-hooks、rules、paths、review、async-hooks、Plan Mode 与 MCP OAuth fixtures。用屏障控制阶段，避免 sleep 和人为加大 timeout。真实 Hook 进程取消沿用当前 post-tool-hooks 的原子 ready-file/两个 PID 发布与 filesystem completion 信号，验证 shell 和子进程均已启动后再收束；不要恢复旧固定轮询等待。

## Verification

尚未实施。执行时追加实际命令、退出码、公开行为证据、focused timing 与未验证范围；不得用文档检查冒充代码验收。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。
