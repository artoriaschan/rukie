# 06: 存储隔离集成与真实打包验收

**What to build:** 按[存储调整规格](../spec.md)和 [ADR-0035](../../../docs/adr/0035-desktop-isolated-sqlite-storage.md) 实施本票能力。

Blocked by: 02, 03, 04, 05

Status: ready-for-agent

- [ ] 集成 01–05，附件原生消息块与外置文件适配不丢图片，文件历史与分支引用、失败写入/清理同步 owning modules
- [ ] 隔离 HOME/TUI 配置和 appData，验证双端同项目独立 Session、信任/凭证/skills/MCP，桌面不写旧用户目录
- [ ] 真实 Session 输出/abort/resume/subagent/readonly/索引失败与 crash 回归；主进程单实例、sidecar shutdown/restart 与 SQLite 连接/执行 lease 清理
- [ ] 实际签名 macOS arm64 app 正常启动，真实 safeStorage/钥匙串录入重启认证、替换删除、取消失败；不用 mock keychain 代表生产成功
- [ ] 完成受影响消费者盘点、focused timings/static 和适用 aggregate 检查；共享配置/存储/Jobs 接缝有跨模块风险时先说明再跑一次全量
- [ ] 同步所有当前 README/architecture/配置例子/tech-stack 与 ADR Coverage，评审和 tracker 状态按真实实施验收更新；仅文档通过不关闭本规格
