Status: ready-for-agent
Blocked by: [02](02-tool-runtime-and-factories.md)

# 03：Bash、Web Fetch、Todo、Jobs 与 Permission Review 归属迁移

## What to build

把工具及关联能力集中在能力模块，将完整 Jobs registry 与工具包装归同一能力目录，并将 Permission Review 收进权限模块。每个内部消费者和当前文档在本票同步迁移。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。依赖票完成且验证通过后才可开始；ready-for-agent 表示信息完备，不表示依赖已解除。

## Scope

迁移 bash/ 至 tools/bash/，web-fetch/ 与 tools/web-fetch.ts 至 tools/web-fetch/，tools/todo.ts 与 tool-state/todo.ts 至 tools/todo/，完整 jobs/ 至 tools/jobs/（内部区分 registry.ts 与 tools.ts），review/ 至 permissions/review.ts。

## Acceptance Criteria

- [ ] Bash 保留同一 jobs.start 进程路径与 pi OutputCapture 约束；仅调整拥有位置和导入，不拆分前后台执行。
- [ ] Web Fetch 保留内部地址/HTTP/代理/内容转换分工、匿名请求、DNS pinning、安全拒绝、重定向、总超时、大小限制与取消。
- [ ] Todo 工具、schema、类型、状态版本解析和提醒集中；Session 从工具入口注册 todoState，tool-state/index.ts 不再导出具体 Todo 定义。
- [ ] 包级 TodoItem 及现有 SessionOptions 的 WebFetchOptions 行为保持兼容，所有内部引用更新。
- [ ] tools/jobs/ 同时提供 registry 与工具工厂，内部区分资源、输出和游标管理与 job_output/job_list/job_kill 协议包装；Session 和 Bash 经该能力入口直接消费 registry。
- [ ] Permission Review 保留独立模型调用、失败转 ask、取消及权限规则，不改变 locale 或输出约定。
- [ ] 更新本票涉及的当前架构/源码链接，删除旧目录、旧文件和废弃内部转导出，镜像的内部测试路径按现有规则迁移；跨概念 e2e 不为对称而搬动。

## Verification

01 协议基线；Bash、Background Jobs、Job API/Notifications/Subagent Jobs、Web Fetch 全部专项、Todo/Reminders、Permission Review/Rules 与 auto-review 的公开测试。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

列出旧归属删除与所有导入更新证据，保留已有文案和结果断言；记录公开测试、格式、lint、类型与相关文档检查。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
