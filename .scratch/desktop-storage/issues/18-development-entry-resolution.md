# 18: 开发入口模块解析

Status: ready-for-agent

Blocked by: 17

用户 dev:desktop 报 ERR_MODULE_NOT_FOUND：缓存 app/package.json 的绝对 main 被 Electron41 init.ts 的 path.join(packagePath,main) 拼接，形成 app/Users/... 的错误目标。修复为缓存 app 内相对 ESM bootstrap 入口，再通过正确 file URL 加载当前 checkout build/main.js；保持 ready 前应用身份/路径配置时序、固定开发数据隔离、稳定开发签名与产物更新合同。旧缓存应自动失效重建，保留 data/electron/session 和用户预览。

- [ ] 通过锁定 upstream 解析规则与 Node 文件接缝复现同一路径错误
- [ ] 相对 ESM 入口、外部 file URL、缓存格式及身份读回检查同步修正
- [ ] 最小模块加载回归覆盖空格/URL 特殊字符路径、await 加载与旧缓存失效，局部静态检查
- [ ] 新两轴只读复核、复用验证快进集成、同步关闭 ticket/spec

遵守原生授权边界：本次普通修复不启动 Electron，不访问钥匙串，不重跑签名、源码/UI 构建、包级/全量/浏览器或 CI。Node 测试使用无 Electron 的受控 ESM fixture，通过与锁定 init.ts 相同的 path.join 入口规则加载。真实启动尚未验收，不把 Node 接缝成功称为原生启动通过。
