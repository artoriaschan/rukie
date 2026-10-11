# 01: 桌面数据根与配置隔离

**What to build:** 按[存储调整规格](../spec.md)和 [ADR-0035](../../../docs/adr/0035-desktop-isolated-sqlite-storage.md) 实施本票能力。

Status: ready-for-agent

- [ ] Electron 确定生产业务数据根、开发/测试显式覆盖；私有传给 sidecar，真实 OS home 独立保留，禁止伪造 homeDir
- [ ] 盘点 settings/trust/permissions/hooks/MCP/credentials/skills/agents/用户规则/能力缓存/文件历史的全部读写与清理，接入桌面来源；终端默认实现保持不变
- [ ] 保留项目输入和现有 trust 规则；禁用 OS home 隐式发现、旧数据导入及共享路径 fallback
- [ ] 公有配置入口验证哨兵隔离、真实 ~/ 路径展开、同一项目跨 Frontend 独立信任；同步当前使用文档
