# 03: 应用数据库与加密凭证

**What to build:** 按[存储调整规格](../spec.md)和 [ADR-0035](../../../docs/adr/0035-desktop-isolated-sqlite-storage.md) 实施本票能力。

Blocked by: 01

Status: claimed

- [x] app.sqlite 事务管理项目/置顶/偏好/配置/供应商/模型/能力缓存；Session 索引可从已提交元数据核对，建库后登记，异常协调不恢复执行
- [x] main safeStorage + 受限 preload 和私有 sidecar 通道；API Key、完整敏感 OAuth state/client_secret 与 MCP 认证 header 均加密，SQLite 只存密文，脱敏列表，保留/替换/删除凭证，认证不读取环境 Key
- [x] 加密不可用、授权取消、解密失败、保存失败没有明文 fallback；renderer 无通用解密入口，日志、WS 和模型上下文不泄露密钥
- [x] 真实数据库验证失败事务、重启、配置原子删除与索引协调；main mock 验证 IPC 信任和取消，真实系统加密验收交给 06

## Implementation Evidence

专用新子代理、独立分支 `feat/desktop-storage-03`，从 integration 的01提交创建，并合入02 portable SQLite adapter。保持 claimed，等待主代理 review、集成与06真实系统/打包验收。使用 tdd 与 rukie-doc 流程；公开 seam 沿规格授权为 AppDatabase 操作、真实 server/WS/Session 与网络边界、受信任 Electron IPC 和 mock safeStorage。

- `app.sqlite` 使用02的 `openBunSqliteDatabase`、WAL/FULL、异步排队事务；项目/置顶/偏好、配置、供应商/模型、能力缓存与Session索引都归此库。真实约束失败回滚供应商配置与凭证，原子删除不删除Session历史。
- 索引从 `discoverSqliteSessions` 的只读已提交元数据核对，覆盖未注册项目的孤立已提交Session；不打开Harness或恢复执行，不读取终端目录。
- main owns safeStorage；私有loopback crypto token和main→sidecar管理token独立于WS token，拒绝renderer Origin。密文envelope绑定provider/OAuth/configuration身份；限大小/用途，失败返回脱敏错误。关闭等待sidecar真实exit并关闭所有crypto连接，启动失败同样释放资源。
- 受限preload `modelServices.list/save/delete`：新密钥在main加密后发私有管理接口，列表只返回hasCredential；keep/replace/delete明确区分，取消或加密失败不发保存请求。无已有明文读取或任意decrypt接口，basic_text不可作为fallback。
- API Key、完整OAuth state（tokens、client_secret、codeVerifier）、完整MCP配置headers及hooks headers经加密后入库；Core保持原有OAuth身份、信任和生命周期，通过 `mcpPersistence` 注入。桌面settings/mcp不读取临时JSON或终端目录。私有token捕获后从sidecar环境删除，工具保留其余正常系统环境。
- `createApplicationModels`只注册显式应用供应商，认证context不读取环境或用户文件。目录只检查密文存在，不调用解密；请求按provider身份取密钥。新发送刷新模型配置，已开始请求持有先前provider对象。删除模型/供应商不隐式选其他provider；返回 `model_unavailable`。无配置/凭证仍可只读订阅历史。
- 显式重新选择缺失模型：`resumeModelSelection`仅在用户session.set_model时应用，先验证当前目录/认证、拒绝持久化pending执行，再经原生configure及Model Selection镜像事实保存同一Session；历史Transcript保持。05必须覆盖只读历史→重新选择→再次发送UI路径。
- 02定位的server退出竞态修正：所有changed()读取/广播登记并在close排空，shuttingDown后不接收新广播；聚焦Run/pending Interaction reproducer无迟到disk-I/O warning。

### Verification

- red tracer：AppDatabase模块不存在先失败；新增真实SQLite实现后通过。provider管理WS目录接线前返回空数组，接线后通过；删除模型后的显式reselect回归先失败，修正Core/server接缝后通过。
- frozen dependency install通过（853packages）；Chromium准备通过。`bun run test:desktop`：23files、83tests通过，8.99s，含新IPC取消/加密不可用、private crypto信任/identity/decrypt失败、preload限制与启动失败cleanup。mock证据不代表真实OS加密。
- storage/config/MCP/server/desktop SQLite focused：133pass、0fail、11files、2.03s；另Model Selection/switch、capability probe、MCP config/OAuth lifecycle：72pass、0fail、6files、3.79s。新增SQLite事务/重启/OAuth密文与网络Session/reselect单例均低于1s；server真实loopback/WS/协议成本保留。
- `bun run check:dev`（format/lint/types/Knip/tracker/docs/boundaries/test-policy/typography）通过；最终补充索引/reselect/生命周期检查后同一静态门禁再次通过。未运行aggregate、CI或真实safeStorage；06负责跨票完整验收。

### ADR Coverage

实施ADR-0035应用SQLite/密文/隔离合同，沿用ADR-0019 MCP身份/OAuth/项目信任、ADR-0034 Cookie-free但显式凭证访问系统safeStorage、ADR-0029 main/server/Core边界。没有新调度或迁移兼容层，无需新增ADR。模型服务UI归05，真实系统加密/打包验收归06。
