# 02: durable 运行基座、目标依赖与公开接口

Status: ready-for-agent
Blocked by: 01

## What to build

切换 Agent Core 的运行所有权与目标依赖，建立 Frontend-facing Session 到 durable Harness/Conversation 的单一路径。更新所有受影响工作区消费者、provider 绑定、模型 helpers 与基础工具协议，不交付旧 API shim、旧 Agent loop fallback 或空实现。后续票补齐专门的状态、恢复和能力验收，不把基础闭环通过描述为整体迁移完成。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [ ] 所有实际需要的 pi/Chord 直接和解析依赖精确对齐 1.0.4；bun.lock 同步；所有工作区移除 pi-agent-core 与旧私有入口。
- [ ] Session 提交、流式观察、工具 execution、steer/follow-up、Run/Turn 结束和 Compaction 调用走原生 Harness；Session 不再修改旧 Agent.state 或自行运行模型循环。
- [ ] 产品 Session 与 Conversation、Harness、Submission 的身份和生命周期映射清楚；公开调用方可区分父 Run idle、任务恢复与整次请求结算。
- [ ] 模型/provider 设置、自定义模型、代理、凭据输入和 fake model helpers 已接入目标 pi-ai；原先支持的模型设置没有因接口升级消失。
- [ ] 订阅使用 committed snapshot/events，处理批量增量和 snapshot 重置；没有重复消息、已关闭视图写入或 callback 自等待。
- [ ] 每次接口变更更新受影响消费者与类型；目录依赖方向继续有效，Frontend 无具体执行器依赖，Agent Core 保持 locale-agnostic；coding-agent 的旧 pi devDependencies 按新测试 helpers 实际消费改为目标版本或移除，不误列为生产依赖。

## Testing Decisions

公开 createSession 的受控模型闭环覆盖 input → model/tool → committed result → idle/close；同时跑 headless main 与最小 TUI 启动，验证消费者同版本契约。模型流多轮次覆盖 microtask 边界与最后事件后的结算。更新现有辅助模型 helper 而非每个套件复制新 provider。运行聚焦测试和受影响格式、lint、类型检查。

## Verification

尚未实施。执行时追加实际命令、退出码、公开行为证据、focused timing 与未验证范围；不得用文档检查冒充代码验收。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。

2026-10-07 基线刷新：Frontend 消费已合并 dsh ink 的公开 API；Session 接口迁移不得恢复旧 renderer options、primitives 或 input event union。当前 Agent Core 和 Headless 生产路径尚未迁移。
