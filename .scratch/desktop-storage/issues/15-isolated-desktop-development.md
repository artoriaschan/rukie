# 15: dev:desktop 开发入口与正式环境隔离

Status: ready-for-agent

Blocked by: 14

**What to build:** 根命令 `bun run dev:desktop` 构建/启动当前源码用于桌面调试。开发版业务数据库、供应商/凭据/会话/附件、Electron user-data/cache/storage、应用/钥匙串身份、单实例锁及构建产物与正式包隔离；不读取/迁移/覆盖正式或终端配置。保留工具真实 OS home，不通过替换 HOME 模拟隔离。重新运行开发命令应可使用独立的开发数据，不依赖旧正式构建。终止开发命令等待所属 Electron/sidecar/开发服务退出。

- [ ] 确定最小启动/调试流程、固定开发身份与路径策略，核对锁定 Electron safeStorage 身份来源
- [ ] 增加 dev:desktop 命令及生产边界约束，构建当前 main/preload/UI 并启动独立开发运行环境
- [ ] 按实际需要提供源码更新/调试能力，严格 renderer/preload 来源校验，不开放正式版网络或任意 IPC
- [ ] 最小 mock/纯函数/进程接缝验证隔离、启动失败和退出清理，更新桌面 README 与适用 ADR
- [ ] 独立两轴复核、记录本地证据与未验收边界后关闭

## Verification scope

验证记录单负责人并复用已有结果，先全部核对隔离边界与生命周期后集中实现。自动验证不启动真实 Electron，不访问系统钥匙串，不修改用户凭据。正式环境与当前用户 Electron/tmp预览保持。不把仅 userData 不同称为钥匙串已隔离。当前请求授权实现开发启动命令；真实系统凭据验收须遵守独立授权边界，未验收的原生事实明确记录。
