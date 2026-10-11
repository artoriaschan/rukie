# 17: 开发 bundle Framework 复制与签名

Status: ready-for-agent

Blocked by: 15

用户运行 dev:desktop 在 codesign 阶段报 Electron Framework.framework unsealed contents。根工作区缓存内 Framework 的 Electron Framework、Resources、Versions/Current 链接实际指向 node_modules 源 app 的绝对路径。修复开发 bundle 复制，保持原生相对链接和独立副本，不修改源 Electron 或正式包；使既有错误开发缓存可恢复，保留 data/electron/session 与用户预览。

- [ ] 最小复现复制链接结构缺陷，对照锁定源 app
- [ ] 修复复制语义及旧缓存重建判定，不降低 codesign 验证要求
- [ ] 单一 owner 最小文件回归与 macOS codesign 构建阶段验收，不启动 Electron/访问钥匙串
- [ ] 新两轴只读复核、集成复用验证并关闭 ticket/spec

本次用户报错授权修复启动命令签名阶段；只验收缓存复制、fuse 和签名，不启动真实应用，不跑完整构建/测试/浏览器/CI。不得仅修改用户缓存而不修源代码；只删除明确归此命令的 cache bundle，保留开发业务数据和正式数据。
