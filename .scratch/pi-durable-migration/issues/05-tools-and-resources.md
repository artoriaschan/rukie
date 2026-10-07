# 05: 自有工具、MCP、图片与 OS 资源适配

Status: ready-for-agent
Blocked by: 04

## What to build

逐项完成现有能力对 durable tools/extensions 与环境的适配。保留自研 bash/Jobs、read 图片、文件跟踪、grep/glob、skills、web fetch、MCP 管理、Side Question、标题和 usage/context 报告；删除旧 runtime adapters 与私有输出采集依赖。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [ ] 每个现有自有能力均有目标 runtime 对应和公开行为验证；没有因上游接口删除而隐藏能力，没有留空 execute 或第二套工具执行器。
- [ ] 默认 unsafe replay 覆盖实际文件写入、bash、MCP 与其他副作用；只有具备稳定身份和重放证明的工具声明 safe，已有已提交 intent 不被当前配置强制扩成 safe。
- [ ] 图片输入、steer 图片、read 图片的内容校验和原始块持久化保留；text-only 降级、模型切换和 Frontend metadata 剥离正确。
- [ ] bash 前后台共用一条启动路径，超时转后台、输出截断、完整输出提示、退出码、取消和 job_* 游标/规则保持可用；旧 harness 私有文件路径全部移除。
- [ ] 宿主 close 终止 OS 进程组并释放输出；Resume 不重建 Job、不重跑 bash，已结算工具生成的旧 Job 不显示为当前活动。
- [ ] MCP 发现、当前能力、动态 refresh、工具错误、OAuth 取消/重连及用户/服务器身份凭据隔离仍成立，宿主关闭释放连接；升级版本不改项目凭据来源。
- [ ] web fetch 的公网/重定向/授权/代理/取消边界和 skills/project instructions 保留；Side Question 不改主 Transcript，标题与用量可恢复。

## Testing Decisions

公开 Session 与实际文件/进程/本地 HTTP-MCP fixture 验证 retained capabilities，复用 jobs、job-api、图片、MCP OAuth lifecycle、skills、reminders 与 web fetch 套件。实际进程清理用 exit/资源信号；同进程限时逻辑用虚拟钟。大样本输出通过 owning module seam，小型 Session 例验证 wiring，不重复昂贵 e2e 设置。

## Verification

尚未实施。执行时追加实际命令、退出码、公开行为证据、focused timing 与未验证范围；不得用文档检查冒充代码验收。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。
