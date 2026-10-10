# 30: 本地 macOS arm64 构建

**What to build:** 一条本地命令构建出可直接打开的 ad-hoc 签名 `.app`：编译 sidecar、放置 `rg`、签名与重签、fuses，以及构建后的自检。见 [spec](../spec.md) 的「本地 macOS 构建」与 [17](17-research-packaging-details.md#answer)。

Blocked by: 25, 26, 29

Status: ready-for-agent

- [ ] sidecar 用 `bun build --compile`，注入 `RUKIE_COMPILED=true` 并关闭 dotenv/bunfig 自动加载，编译设置与 `scripts/release/build.ts` 共用
- [ ] sidecar 与锁定的 `@vscode/ripgrep-darwin-arm64` 的 `rg` 经 `extraResources` 放到 `Contents/Resources/sidecar/`；grep 工具在打包后找到 `rg`；编译版缺 ripgrep 的报错不再提 npm optionalDependencies
- [ ] `mac.identity: "-"` + hardened runtime；Electron 保留 `disable-library-validation`；`afterSign` 给 sidecar 只留 `allow-jit`、`rg` 无 entitlement并重封
- [ ] `afterPack` 用 `@electron/fuses` 2.0.0 设置 fuses；先确认 electron-builder 26.15.3 是否写入 `ElectronAsarIntegrity`，未写入则不开完整性 fuse，结论记入本票
- [ ] 构建脚本断言 `codesign --verify --deep --strict` 通过，并经 `BUN_BE_BUN=1` 断言 sidecar JIT 生效；不运行 `spctl`
- [ ] 本机 `open` 打开构建出的 `.app`，完成添加项目、新建 Session、流式回复与一次权限审批的手动冒烟，记录在本票
- [ ] 不接入 GitHub Actions；`docs/release-building.md` 或 desktop README 写明本地构建命令与前置条件
