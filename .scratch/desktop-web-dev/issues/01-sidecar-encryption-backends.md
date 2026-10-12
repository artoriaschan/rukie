# 01：sidecar 加密后端显式选择

Status: ready-for-agent

**What to build:** 按 [spec](../spec.md#配置与加密) 与 [ADR-0037](../../../docs/adr/0037-browser-host-sidecar-capabilities.md#加密后端)，sidecar 进程入口通过私有启动变量显式选择 `electron`、`system-keychain` 或 `memory` 加密后端，实现后两者。

- [ ] 进程入口新增后端选择变量；`electron` 需要现有 secret URL/token，`system-keychain` 需要服务名；缺失或不完整时启动失败，不推断、不回退。读取后从 `process.env` 删除，工具子进程不可见
- [ ] Electron main 显式传 `electron`；正式与开发启动行为不变
- [ ] `system-keychain`：经可注入的 secrets store（生产为 `Bun.secrets`）保存每个安装一把 AES-256-GCM 主密钥；密文绑定凭证身份，沿用 vault 的身份正则；首次加密时创建，读取失败或授权取消返回现有可重试错误，不新建覆盖已有主密钥
- [ ] `memory`：进程内主密钥，退出即失效
- [ ] 测试注入假的 secrets store，覆盖创建、复用、失败不覆盖、身份不匹配拒绝、后端缺失启动失败、私有变量不泄露到工具环境；不访问真实钥匙串
- [ ] 更新 server README 的启动变量与加密说明
