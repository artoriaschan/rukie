# 01: Bun 与 pi 1.0.4 最小执行验证

Status: ready-for-agent

## What to build

用精确 1.0.4 发布依赖，在隔离目录验证 Bun 上的 durable 最小闭环；这张票是执行可行性门槛，不改真实用户配置，不将 npm README 的声明当作已验证。核对当前 Bun 版本与目标依赖 requirements，保留可运行的最小验证入口与结果供后续票复用。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [ ] 目标 pi-durable、pi-ai、pi-mcp、Chord 与需要的 Pi 支撑包实际解析到 1.0.4，TypeBox 与它们保持一致；未误用 main 分支或不同版本 types。
- [ ] 公开 Harness 在 Bun 下可完成假模型 open → submit → streaming watch → wait → close → reopen；JSONL fsync 开启，已提交输入、部分输出、结果和 documents 可观察。
- [ ] 实际文件工具及自有环境消费方式可用，异步 beforeTool 的等待、关闭、重新打开行为有可复现结果；不把等待 callback 当作持久化审批协议。
- [ ] 提交前、模型流中、工具 intent 提交后和结果提交后的重开验证，能区分 safe replay 与默认 unsafe interrupted；同一 requestId 不重复创建逻辑提交。
- [ ] 核对原生 close、abort、后台 ownership、fork/rewindable documents 和事件 snapshot 的可消费 API；标明是否能支持本规格必要能力。
- [ ] 隔离文件与进程完成清理；报告真实命令、运行时版本、结果与限制。确有阻碍时提供最小复现，不擅自改成旧 runtime fallback。

## Testing Decisions

测试 seam 是公开 Harness/Conversation，作为尚未接入 Session 的唯一底层可行性试验。使用受控 faux provider 和临时 cwd/homeDir/storage；以 commit、模型请求屏障与过程 exit 同步。真正重启场景使用独立进程，记录其必要成本；无需全库业务测试或生产凭据。

## Verification

尚未实施。执行时追加实际命令、退出码、公开行为证据、focused timing 与未验证范围；不得用文档检查冒充代码验收。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。

2026-10-07 基线刷新：当前代码 92d17ca1，宿主 Bun 1.4.2 已实测。现有 dsh ink 的 Bun 验收不是 pi-durable 可行性证据，本票仍须独立完成精确 1.0.4 的上述闭环。
