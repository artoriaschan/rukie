# 30: 本地 macOS arm64 构建

**What to build:** 一条本地命令构建出可直接打开的 ad-hoc 签名 `.app`：编译 sidecar、放置 `rg`、签名与重签、fuses，以及构建后的自检。见 [spec](../spec.md) 的「本地 macOS 构建」与 [17](17-research-packaging-details.md#answer)。

Blocked by: 25, 26, 29

Status: claimed

- [x] sidecar 用 `bun build --compile`，注入 `RUKIE_COMPILED=true` 并关闭 dotenv/bunfig 自动加载，编译设置与 `scripts/release/build.ts` 共用
- [x] sidecar 与锁定的 `@vscode/ripgrep-darwin-arm64` 的 `rg` 经 `extraResources` 放到 `Contents/Resources/sidecar/`；grep 工具在打包后找到 `rg`；编译版缺 ripgrep 的报错不再提 npm optionalDependencies
- [x] `mac.identity: "-"` + hardened runtime；Electron 保留 `disable-library-validation`；`afterSign` 给 sidecar 只留 `allow-jit`、`rg` 无 entitlement并重封
- [x] `afterPack` 用 `@electron/fuses` 2.0.0 设置 fuses；先确认 electron-builder 26.15.3 是否写入 `ElectronAsarIntegrity`，未写入则不开完整性 fuse，结论记入本票
- [x] 构建脚本断言 `codesign --verify --deep --strict` 通过，并经 `BUN_BE_BUN=1` 断言 sidecar JIT 生效；不运行 `spctl`
- [x] 本机 `open` 打开构建出的 `.app`，完成添加项目、新建 Session、流式回复与一次权限审批的手动冒烟，记录在本票
- [x] 不接入 GitHub Actions；`docs/release-building.md` 或 desktop README 写明本地构建命令与前置条件

## Comments

2026-10-11 — 实现完成，Status 保持 claimed，等待独立审查与最终验证。根命令 `bun run desktop:build --out /tmp/rukie-desktop-artifacts` 生成 `package/mac-arm64/Rukie.app`；构建与 CLI release 共用 `scripts/compiled-bun.ts` 的编译合同。实际包内 grep 成功返回 `smoke-result.txt:1:packaged-smoke`。Core 与 zh/en 错误提示统一改为恢复完整安装，不再引导桌面用户使用 npm optionalDependencies。

阅读安装的 app-builder-lib 26.15.3：platformPackager 在 copyAppFiles 后调用 framework.beforeCopyExtraFiles 计算 asar integrity，electronMac 写 ElectronAsarIntegrity，随后才 emitAfterPack。构建对实际 Info.plist 检查成功，启用了 EmbeddedAsarIntegrityValidation 与 OnlyLoadAppFromAsar；关闭 RunAsNode、NODE_OPTIONS、Node inspect，Cookie Encryption 开启。afterSign 将 sidecar 收紧到仅 allow-jit、rg 无 entitlement，并重封外层 app。实际 strict deep codesign 通过，runtime flags 和 entitlements 校验通过，DFG JIT count=1；禁用 JIT 的负例 count=1000000、退出 1。未运行 spctl。

真实打包 smoke：`open -n -W` 启动生产编译 sidecar，HOME/user-data 隔离，唯一模型替身为已有 fakeModel 的外部 loopback 传输桥。原生目录选择器添加项目、首次发送创建 Session、barrier 控制的中间流式文字、一次 bash 允许审批、实际文件写入、包内 grep 和最终回复全部观察到。退出后公共 readSessionSnapshot 读出 9 条持久化消息与一个成功 Run Summary，Session id 为 `73866a17-dd48-4e9a-bf30-f0d06d95e21d`。窗口关闭后 open 退出 0，Electron 与 sidecar 均退出，桥与隔离目录已清理。Mac 在退出时锁定，使用 CDP window.close() 触发实际窗口关闭生命周期。

证据在 `/tmp/rukie-desktop-evidence/issue30/`：streaming.png、permission.png、completed-dark.png、completed-light.png、completed-narrow.png、grep-output.png、transcript.json、tool-result.txt、acceptance.md 与签名/JIT日志。成功 smoke 的 console/errors 为空，捕获到的 app HTML/JS/CSS/highlight 请求均 200；不把捕获范围描述为所有请求。Vite 保留大 chunk warning，前票 favicon findings 交最终审查。

环境限制：隔离 HOME 的首次启动卡在 Chromium Keychain 初始化（SecItemAdd → defaultKeychainUI → AuthorizationCopyRights），sample 已保存；验收使用 `--use-mock-keychain` 测试启动参数，生产加密 fuse 不变。外部桥的初始兼容配置、数组消息解析和默认 HTTP idle timeout 失败已诊断并修正，失败 Session 不作为验收。

验证：`bun run test:desktop` 14 files / 45 tests 通过（5.25 s）；i18n 文案先复现 2 个失败，再 `env -u NO_COLOR bun test packages/i18n/tests/i18n.test.ts packages/agent/tests/e2e/tools.test.ts` 37 pass / 211 assertions（1.134 s，真实工具集成），`bun run check:dev` 通过。最终提交与产物源码身份记录在外部 desktop-build.json；交付前合入当前集成分支并补充 focused/static 验证。
