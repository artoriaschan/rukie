# 15: dev:desktop 开发入口与正式环境隔离

Status: resolved

Blocked by: 14

**What to build:** 根命令 `bun run dev:desktop` 构建/启动当前源码用于桌面调试。开发版业务数据库、供应商/凭据/会话/附件、Electron user-data/cache/storage、应用/钥匙串身份、单实例锁及构建产物与正式包隔离；不读取/迁移/覆盖正式或终端配置。保留工具真实 OS home，不通过替换 HOME 模拟隔离。重新运行开发命令应可使用独立的开发数据，不依赖旧正式构建。终止开发命令等待所属 Electron/sidecar/开发服务退出。

- [x] 确定最小启动/调试流程、固定开发身份与路径策略，核对锁定 Electron safeStorage 身份来源
- [x] 增加 dev:desktop 命令及生产边界约束，构建当前 main/preload/UI 并启动独立开发运行环境
- [x] 按实际需要提供源码更新/调试能力，严格 renderer/preload 来源校验，不开放正式版网络或任意 IPC
- [x] 最小 mock/纯函数/进程接缝验证隔离、启动失败和退出清理，更新桌面 README 与适用 ADR
- [x] 独立两轴复核、记录本地证据与未验收边界后关闭

## Verification scope

验证记录单负责人并复用已有结果，先全部核对隔离边界与生命周期后集中实现。自动验证不启动真实 Electron，不访问系统钥匙串，不修改用户凭据。正式环境与当前用户 Electron/tmp预览保持。不把仅 userData 不同称为钥匙串已隔离。当前请求授权实现开发启动命令；真实系统凭据验收须遵守独立授权边界，未验收的原生事实明确记录。

## Implementation evidence

- `dev:desktop` 独立入口构建当前 main/preload/UI/compiled sidecar，`app://rukie` +原有 preload/IPC 校验保持，打开 DevTools，修改源码关闭后重跑。`.desktop-dev` 内固定业务data、ElectronuserData/session/cache/build；保留真实HOME，不迁移正式/TUI数据。独占launcher锁避免并行改写；符号链接、环境覆盖、错误cache身份拒绝。
- 固定开发 manifest/name、pre-ready app name、bundle identity；Electron41.0.3上游证明macOSKeychain service/account依赖appname。缓存devbundle关闭CookieEncryption、ad-hoc签名后复用；当前代码产物在bundle外更新。新原生启动与系统钥匙串事实未验收。
- 公开launcher/filesystem/controlledprocess接缝：2cases90ms；增量artifact/env/exclusive锁case1pass19ms；developmentbootstrapmock2cases110ms。当前main/preload/UI/compiledsidecar源码构建成功，Vite581ms；未运行真实Electron/正式打包/钥匙串。
- 已有包级证据复用，变更文件format/lint、scripts/desktop类型、Knip、docs/test-policy通过；验证记录保存全部RED、fixture真实路径失败、Vitest启动目录失败和类型tuple修正事实，不用后续通过覆盖失败。
- 外部记录 `/tmp/rukie-desktop-dev15-evidence/verification.md`，实施代理唯一验证负责人；评审、集成、关闭不得重跑有效范围。ADR沿用0034/0035，开发隔离细节补充0035。

### 集中评审修正

Standards 两项 P1 已修复：父进程退出后仍确认所属进程组实际无可继续工作的成员，无法确认清理则保留入口锁并非零退出；business/Electron userData/session 持久化树拒绝符号链接，顶层 Chromium IPC 链接不跟随、活动 PID 拒绝、持有 launcher 锁后只移除三个 exact 名称。删除 Electron 未定义的 cache specialpath，Chromium cache 由 sessionData 隔离。新增三项公开接缝测试 3 pass / 3 filtered，92ms；受影响 bootstrap mock 文件 3 pass，133ms；变更文件格式/lint 与 scripts/desktop 类型检查通过。父代理只读复核已关闭两项 P1 与 cache 缺陷，原生验收仍未执行。

最终交付：候选 `7414cb96` 经新 merger 快进至 `feat/desktop-storage`，集成工作树与祖先确认通过；父代理复用现有测试和静态证据，不重复执行。Spec 独立评审零阻止项，Standards 与父代理发现已全部关闭。ADR Coverage 归 spec：更新 ADR-0035 的开发隔离与生命周期，沿用 ADR-0034/0029；15 与 spec 同时 resolved。真实开发 bundle 创建/签名/运行及系统凭据未验收，保留用户旧 Electron；按用户要求本地交付不等待 CI，PR 等待评审，未授权合并。
