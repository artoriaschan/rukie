# 18: 开发入口模块解析

Status: claimed

Blocked by: 17

用户 dev:desktop 报 ERR_MODULE_NOT_FOUND：缓存 app/package.json 的绝对 main 被 Electron41 init.ts 的 path.join(packagePath,main) 拼接，形成 app/Users/... 的错误目标。修复为缓存 app 内相对 ESM bootstrap 入口，再通过正确 file URL 加载当前 checkout build/main.js；保持 ready 前应用身份/路径配置时序、固定开发数据隔离、稳定开发签名与产物更新合同。旧缓存应自动失效重建，保留 data/electron/session 和用户预览。

- [ ] 通过锁定 upstream 解析规则与 Node 文件接缝复现同一路径错误
- [ ] 相对 ESM 入口、外部 file URL、缓存格式及身份读回检查同步修正
- [ ] 最小模块加载回归覆盖空格/URL 特殊字符路径、await 加载与旧缓存失效，局部静态检查
- [ ] 新两轴只读复核、复用验证快进集成、同步关闭 ticket/spec

遵守原生授权边界：本次普通修复不启动 Electron，不访问钥匙串，不重跑签名、源码/UI 构建、包级/全量/浏览器或 CI。Node 测试使用无 Electron 的受控 ESM fixture，通过与锁定 init.ts 相同的 path.join 入口规则加载。真实启动尚未验收，不把 Node 接缝成功称为原生启动通过。

## 实施与验证

- 缓存 manifest 的 main 改为相对 bootstrap.mjs，入口以 pathToFileURL 的外部 main URL 做 top-level await import；保持 Electron41 ESM appCodeLoaded 之前完成 main 身份和路径配置。entryFormat 及 externalMain 进入 marker，旧绝对 main 缓存自动重建。缓存入口的目录、manifest、bootstrap 都做链接与内容读回校验。
- 无 Electron 的 Node 文件接缝先复现相同 ERR_MODULE_NOT_FOUND，再验证带空格、#、%、Unicode 的路径与不同 cwd、依赖完成、下一次 main 更新使用同一 stub，并拒绝旧 main、篡改入口和链接。最小单例最终 1 pass、7 filtered、5 assertions、191 ms；初始依赖启动失败和产品 RED 事实保留于验证记录。
- scripts 类型、局部 lint/格式、144 文档链接与 diff 检查通过。已有 issue17 runtime copy/签名证据复用；本次未启动 Electron、访问钥匙串、重签名、构建源码/UI、运行包级/全量/browser/CI。真实应用启动未验收。记录 /tmp/rukie-entry18-evidence/verification.md。
- ADR coverage：沿用 ADR0035 的开发身份、路径与稳定缓存合同；仅修复入口解析与时序，不改变架构决定，无需新增 ADR。

- 两轴只读复核均为 0 findings；父代理核对 diff 与验证记录无新增问题。复用已有证据，未重复运行验证。票据保持 claimed，待集成代理同步关闭。
