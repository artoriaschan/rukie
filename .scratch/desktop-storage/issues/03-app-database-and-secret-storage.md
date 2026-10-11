# 03: 应用数据库与加密凭证

**What to build:** 按[存储调整规格](../spec.md)和 [ADR-0035](../../../docs/adr/0035-desktop-isolated-sqlite-storage.md) 实施本票能力。

Blocked by: 01

Status: ready-for-agent

- [ ] app.sqlite 事务管理项目/置顶/偏好/配置/供应商/模型/能力缓存；Session 索引可从已提交元数据核对，建库后登记，异常协调不恢复执行
- [ ] main safeStorage + 受限 preload 和私有 sidecar 通道；API Key、完整敏感 OAuth state/client_secret 与 MCP 认证 header 均加密，SQLite 只存密文，脱敏列表，保留/替换/删除凭证，认证不读取环境 Key
- [ ] 加密不可用、授权取消、解密失败、保存失败没有明文 fallback；renderer 无通用解密入口，日志、WS 和模型上下文不泄露密钥
- [ ] 真实数据库验证失败事务、重启、配置原子删除与索引协调；main mock 验证 IPC 信任和取消，真实系统加密验收交给 06
