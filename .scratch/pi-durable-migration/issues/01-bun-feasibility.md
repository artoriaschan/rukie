# 01: Bun 与 pi 1.0.4 最小执行验证

Status: resolved

## What to build

用精确 1.0.4 发布依赖，在隔离目录验证 Bun 上的 durable 最小闭环；这张票是执行可行性门槛，不改真实用户配置，不将 npm README 的声明当作已验证。核对当前 Bun 版本与目标依赖 requirements，保留可运行的最小验证入口与结果供后续票复用。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [x] 目标 pi-durable、pi-ai、pi-mcp、Chord 与需要的 Pi 支撑包实际解析到 1.0.4，TypeBox 与它们保持一致；未误用 main 分支或不同版本 types。
- [x] 公开 Harness 在 Bun 下可完成假模型 open → submit → streaming watch → wait → close → reopen；JSONL fsync 开启，已提交输入、部分输出、结果和 documents 可观察。
- [x] 实际文件工具及自有环境消费方式可用，异步 beforeTool 的等待、关闭、重新打开行为有可复现结果；不把等待 callback 当作持久化审批协议。
- [x] 提交前、模型流中、工具 intent 提交后和结果提交后的重开验证，能区分 safe replay 与默认 unsafe interrupted；同一 requestId 不重复创建逻辑提交。
- [x] 核对原生 close、abort、后台 ownership、fork/rewindable documents 和事件 snapshot 的可消费 API；标明是否能支持本规格必要能力。
- [x] 隔离文件与进程完成清理；报告真实命令、运行时版本、结果与限制。确有阻碍时提供最小复现，不擅自改成旧 runtime fallback。

## Testing Decisions

测试 seam 是公开 Harness/Conversation，作为尚未接入 Session 的唯一底层可行性试验。使用受控 faux provider 和临时 cwd/homeDir/storage；以 commit、模型请求屏障与过程 exit 同步。真正重启场景使用独立进程，记录其必要成本；无需全库业务测试或生产凭据。

## Verification

2026-10-08：隔离 [probe](../probe/README.md)通过 Bun 1.4.2 的公开 Harness 可行性门槛。`rtk proxy bun install --frozen-lockfile --ignore-scripts`、`rtk proxy bun run typecheck`、`rtk proxy bun test probe.test.ts` 均退出码 0；11 项测试、52 条断言，总计 1.399 秒，独立进程案例约 148–163 毫秒。精确 1.0.4 包和 TypeBox 1.3.27 的实际解析见独立 package/lockfile。pi-mcp 公共入口导入成功。探针的 8 个 SIGKILL/reopen 场景覆盖 admitted input、partial、beforeTool、safe/unsafe intent、双向 replay 策略变化和 committed result；另验证原生 close/reopen、实际文件工具、自有 env 消费、documents/fork/events/background ownership。临时目录及 worker 均在 finally 清理。未验证真实模型、MCP/OAuth 服务或生产迁移；未运行全库检查。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。

2026-10-07 基线刷新：当前代码 92d17ca1，宿主 Bun 1.4.2 已实测。现有 dsh ink 的 Bun 验收不是 pi-durable 可行性证据，本票仍须独立完成精确 1.0.4 的上述闭环。

2026-10-08：以公开 Harness/Conversation seam 逐片 TDD，初始缺失实现/worker 的 red 失败后完成 green；无旧引擎 fallback。exact 1.0.4 的安全重放 execute 不重新运行 beforeTool，04/05 必须在 execute 路径执行当前授权检查。该 API 义务已记录在探针，沿用 spec/ADR-0024，无新架构决定。

审阅修正：admitted 场景在 Generation beforeRequest 的受控屏障等待，先取得已提交 submission ID，再发布 READY；第一进程 provider callCount 明确断言为 0，排除 SIGKILL 前模型已经完成的竞态。共享 worker 的精简与 metadata 变更后重跑隔离 11 项测试，52 条断言通过；不是全库重跑。

清理审阅修正：三个进程内 helper 使用 try/finally 收束所有已打开 Harness/env；beforeTool/anchor 屏障使用取消 context deadline，Harness/env close 使用独立 3 秒清理 context。进程 finally 同时终止两 worker，并以新 3 秒 deadline 等待 exit，保留 finally 删除 storage；wire JSON 经 TypeBox schema 验证。共享清理基础设施变更后完整隔离探针重跑：11 项/52 断言通过，1.399 秒，typecheck 退出码 0。
