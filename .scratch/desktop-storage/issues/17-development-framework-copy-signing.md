# 17: 开发 bundle Framework 复制与签名

Status: claimed

Blocked by: 15

用户运行 dev:desktop 在 codesign 阶段报 Electron Framework.framework unsealed contents。根工作区缓存内 Framework 的 Electron Framework、Resources、Versions/Current 链接实际指向 node_modules 源 app 的绝对路径。修复开发 bundle 复制，保持原生相对链接和独立副本，不修改源 Electron 或正式包；使既有错误开发缓存可恢复，保留 data/electron/session 与用户预览。

- [x] 最小复现复制链接结构缺陷，对照锁定源 app
- [x] 修复复制语义及旧缓存重建判定，不降低 codesign 验证要求
- [x] 单一 owner 最小文件回归与 macOS codesign 构建阶段验收，不启动 Electron/访问钥匙串
- [ ] 新两轴只读复核、集成复用验证并关闭 ticket/spec

本次用户报错授权修复启动命令签名阶段；只验收缓存复制、fuse 和签名，不启动真实应用，不跑完整构建/测试/浏览器/CI。不得仅修改用户缓存而不修源代码；只删除明确归此命令的 cache bundle，保留开发业务数据和正式数据。

## 实施与本地证据

默认 fs.cp 重写 Framework 的相对链接为源 app 的绝对链接；开发 runtime 复制改用 verbatimSymlinks，保持三个原生相对链接与独立副本。缓存 identity 增加 runtimeCopyFormat=1，旧 identity 自动失效并仅重建所属 cache app。真实文件 fixture 先红后绿：最终 1 pass、5 asserts、24ms；副本修改/源删除不影响独立性。

单一 owner 记录在 /tmp/rukie-framework17-evidence/verification.md，保留依赖启动失败。隔离候选实际复制/fuse/adhoc 签名和 unchanged codesign --verify --deep --strict 通过；旧 marker 恢复分支通过，data/electron/session 哨兵保留，root 原 runtime 272 个文件 hash/链接前后相同。原未封装 source strictverify 的 resource-seal 缺失失败保留，未重签原 runtime。相关格式、lint、scripts 类型检查通过；未源码/UI 全构建、Electron 启动、钥匙串、包级/全量、浏览器或 CI。

ADR Coverage：修正 ADR-0035 所属开发 bundle 复制实现，保持既有隔离与签名合同，无新架构决定。等待两轴只读复核与父集成关闭；root 用户故障缓存下次 dev:desktop 会自动重建，无需删除业务数据。
