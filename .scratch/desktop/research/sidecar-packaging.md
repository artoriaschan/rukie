# 研究：Bun sidecar 的打包与分发

回答 [工单 11](../issues/11-research-sidecar-packaging.md)。版本基线：Bun 1.4.2、Electron 41.0.3、electron-builder 26.15.3（app-builder-lib 26.15.3，依赖 @electron/osx-sign 1.3.3、@electron/notarize 2.5.0、@electron/universal 2.0.3）、@electron/fuses 2.0.0。

来源分三类：官方文档（固定到版本 tag）、npm 已发布 tarball 中的源码与类型声明、2026-10-09 在 macOS arm64 / Bun 1.4.2 上的本地实验（标“实测”）。实验未使用 Developer ID 证书，未提交公证，未在 Windows 上运行。

## 结论

1. 用 `bun build --compile` 按平台出单文件 sidecar，经 electron-builder `extraResources` 放到 `Contents/Resources/`（Windows 为 `resources/`），不放进 asar。不附带独立 Bun 运行时与源码。
2. ripgrep 不能沿用当前 `import("@vscode/ripgrep")` 的解析方式：编译产物内该模块必然抛错。sidecar 应接收宿主给出的 rg 绝对路径（或按 `process.execPath` 相对定位），rg 作为独立文件随 `extraResources` 分发。这与 ADR-0023 npm 平台包的资源定位是同一问题，应共用一个“编译产物资源定位”实现。
3. macOS：sidecar 必须用 Developer ID、hardened runtime、secure timestamp 签名，并带 `com.apple.security.cs.allow-jit`。缺这个 entitlement 时进程不会崩溃，而是 JSC 退回解释器，实测慢约 12 倍。electron-builder 会自动签 `Contents/` 下的 Mach-O 文件；sidecar 和 rg 都应使用专门的 `entitlementsInherit` 或通过 `binaries` 显式列出。
4. `@electron/fuses` 只修改 Electron 主二进制，对 sidecar 无约束，也不提供保护。sidecar 自身的等价加固要靠 Bun 编译选项和启动环境：关闭 `.env`/`bunfig.toml` 自动加载，并在拉起时清除 `BUN_BE_BUN`、`BUN_OPTIONS`。
5. Windows：sidecar `.exe` 位于 `resources/`，electron-builder 会在 `extraResources` 复制阶段自动签名；`rg.exe` 同样以 `.exe` 结尾，自动覆盖。证书需 EV 或 Azure Trusted Signing。

## 1. 单文件编译 vs 运行时加源码

| 方案                                | 优点                                                                                                      | 问题                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun build --compile` 单文件        | 与 ADR-0023 npm 分发同一产物形态；只有一个 Mach-O 需要签名；不需要在包里携带 `node_modules`；支持交叉编译 | 原生子进程资源（rg）和 `.node` 插件需要单独处理；每平台约 59 MB（实测 arm64）                                                                                          |
| 附带 `bun` 可执行文件 + 源码/bundle | 资源路径与开发态一致                                                                                      | 源码与 `node_modules` 会被 smart unpack 或 asar 处理（见第 2 节）；`bun` 二进制本身可执行任意脚本，攻击面大于单入口程序；与 npm 分发产物不一致，需要两条构建与验收路径 |

依据：

- `--compile` 将入口打包进单个可执行文件，支持 `--target=bun-darwin-arm64`/`bun-darwin-x64`/`bun-windows-x64`/`bun-windows-arm64`/`bun-linux-*` 交叉编译；Windows 元数据（图标、版本等）不能交叉编译，只有 `hideConsole` 例外。[Bun v1.4.2 executables 文档](https://github.com/oven-sh/bun/blob/bun-v1.4.2/docs/bundler/executables.mdx)
- 实测：arm64 宿主执行 `--target=bun-darwin-x64` 时下载对应运行时后成功产出；编译产物只链接系统库（`libicucore`、`libresolv`、`libc++`、`libSystem`），没有额外 dylib 需要随包或签名。
- 实测：`lipo -create` 合并 arm64 与 x64 编译产物后，arm64 端运行正常（Bun 将负载放在 `__BUN` segment，lipo 按切片保留）。x64 切片因本机未装 Rosetta 无法运行，**未验证**。因此 universal 构建在 sidecar 层面可行，但需要在 x64 机器上验收。@electron/universal 会对两次构建中 SHA 不同的 Mach-O 自动 lipo，相同则要求被 `x64ArchFiles` 覆盖。[@electron/universal 2.0.3 dist/cjs/index.js](https://www.npmjs.com/package/@electron/universal/v/2.0.3)
- Worker 必须作为额外入口列出（当前 TUI 的 sixel worker 有此需求，sidecar 若不使用 sixel 则无影响）。[Bun v1.4.2 文档 Worker 节](https://github.com/oven-sh/bun/blob/bun-v1.4.2/docs/bundler/executables.mdx)

建议：采用单文件。sidecar 入口与 npm CLI 入口应共享同一套编译脚本和资源清单；`packages/server` 编译出的 sidecar 是另一个入口，不复用 CLI 二进制本身。

## 2. electron-builder 中的放置：`extraResources`，不要放进 asar

- `extraResources` 将文件直接复制到资源目录（macOS `Contents/Resources`，Windows/Linux `resources`），支持 `from`/`to` 与 `${arch}` 等文件宏。[app-builder-lib 26.15.3 `out/options/PlatformSpecificBuildOptions.d.ts`](https://www.npmjs.com/package/app-builder-lib/v/26.15.3)
- asar 内的文件不能用 `spawn` 执行，只有 `execFile` 会被 Electron 透明解包到临时文件。[Electron v41.0.3 asar-archives](https://github.com/electron/electron/blob/v41.0.3/docs/tutorial/asar-archives.md)。sidecar 由 main 进程以普通子进程（`spawn`）拉起，放 asar 不可行；`asarUnpack` 能解决执行问题，但会把 sidecar 混进 `app.asar.unpacked` 的模块目录，路径更绕，没有收益。
- 如果把 sidecar 作为依赖放进 `files`，electron-builder 的 smart unpack 会把任何包含无扩展名二进制、`.node`、`.dylib`、`.exe` 的 **整个模块目录** 解包。[app-builder-lib 26.15.3 `out/asar/unpackDetector.js`](https://www.npmjs.com/package/app-builder-lib/v/26.15.3)。这再次说明 sidecar 与 rg 不应走 `files`。
- ASAR integrity 只对 `.asar` 文件计算哈希，`extraResources` 中的非 asar 文件不在其覆盖范围内。[app-builder-lib 26.15.3 `out/asar/integrity.js`](https://www.npmjs.com/package/app-builder-lib/v/26.15.3)。macOS 上它们由签名封印保护，Windows 上由 Authenticode 签名保护（见第 4、5 节）。

示意配置（路径为占位，构建脚本按 arch 生成到 `dist/sidecar/<arch>/`）：

```yaml
# electron-builder.yml 片段
asar: true
extraResources:
  - from: dist/sidecar/${arch}/
    to: sidecar/
    filter: ["rukie-server*", "rg*", "THIRD_PARTY_NOTICES*"]
mac:
  hardenedRuntime: true # 默认值，显式写出
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.inherit.plist
  notarize: true
```

main 进程在打包态用 `process.resourcesPath` 拼出 `sidecar/rukie-server` 路径，开发态改为直接 `bun packages/server/src/main.ts`。

## 3. ripgrep 等原生资源的复用

### 当前实现在编译产物中失效（实测）

`packages/agent/src/tools/grep.ts` 动态导入 `@vscode/ripgrep`，上游在模块加载时调用 `createRequire(import.meta.url).resolve("@vscode/ripgrep-<platform>-<arch>/bin/rg")`。[vscode-ripgrep v1.18.0 lib/index.js](https://github.com/microsoft/vscode-ripgrep/blob/v1.18.0/packages/ripgrep/lib/index.js)

实测在编译产物中：

- `import.meta.dir` 为 `/$bunfs/root`，`require.resolve` 找不到平台包，抛出 `Could not find @vscode/ripgrep-darwin-arm64`。即使二进制就放在含 `node_modules` 的目录旁边也一样失败。
- 用 `import rg from ".../bin/rg" with { type: "file" }` 嵌入后，得到 `/$bunfs/root/rg-<hash>.` 路径，`Bun.spawn` 直接执行报 `ENOENT: posix_spawn`。只能先写出到磁盘、`chmod 755` 后执行。
- 写出临时可执行文件会在运行期产生未签名（或签名需重新校验）的 Mach-O，并需要可写可执行目录，桌面端不应采用。

这与 `.scratch/headless-agent/bundled-ripgrep.md` 中“Bun 单文件发行和 Electron 资源打包另行处理”的保留项一致，ADR-0023 的 npm 规格也已把“ripgrep 定位相对于安装产物”列为要求（[npm 发布规格](../../npm-release/spec.md) 实现决定 6）。

### 建议的统一做法

- Agent Core 的 grep 改为从注入配置读取 rg 绝对路径（源码运行时仍可回落到 `@vscode/ripgrep` 解析）。编译产物由启动方提供：npm launcher 和 Electron main 各自把平台包/资源目录里的 rg 路径传给二进制（参数或环境变量），或者二进制按 `dirname(process.execPath)` 定位同目录 rg。两种方式都能共用一个“编译产物资源清单”。
- 构建脚本按目标平台从对应 `@vscode/ripgrep-<platform>-<arch>` 包复制 `bin/rg[.exe]` 到产物目录。交叉构建需用 `npm_config_arch`/显式包名选择平台包，不能依赖宿主 `process.arch`。
- 这样 npm 平台包（`bin/rukie` + `bin/rg`）和 Electron `Resources/sidecar/`（`rukie-server` + `rg`）是同一份目录布局，安装验收用例也能复用。

### `.node` 插件

Bun 支持把 `.node` 文件嵌入可执行文件，前提是 `require` 直接引用 `.node` 路径。[Bun v1.4.2 文档 Embed N-API Addons](https://github.com/oven-sh/bun/blob/bun-v1.4.2/docs/bundler/executables.mdx)。当前 `packages/agent` 依赖中没有原生插件；`sharp`（libvips dylib）只在 coding-agent 的 TUI 图片路径使用。sidecar 若不引入 sharp 可不处理；若引入，dylib 无法从 `$bunfs` 被 dyld 加载，需要像 rg 一样作为外部文件分发并签名。**未实测**。

## 4. macOS 签名、公证与 hardened runtime

### electron-builder 会签哪些文件

- @electron/osx-sign 遍历 `Contents/` 下所有文件，按 `isBinaryFile` 判定二进制，再加上 `binaries` 选项中的路径，**由深到浅**逐个 `codesign --force --timestamp` 签名，最后签 `.app`。[@electron/osx-sign 1.3.3 `dist/cjs/sign.js`、`dist/cjs/util.js`](https://www.npmjs.com/package/@electron/osx-sign/v/1.3.3)
- 因此 `Contents/Resources/sidecar/rukie-server` 与 `rg` 会被自动发现并签名，不需要额外 `afterSign` 脚本。`binaries` 用于 `Contents/` 之外或希望显式列出的路径。[app-builder-lib 26.15.3 `out/mac/MacTargetHelper.js`](https://www.npmjs.com/package/app-builder-lib/v/26.15.3)
- 每个非主 app 的文件使用 `entitlementsInherit`；未配置时退回 `build/entitlements.mac.inherit.plist`，再退回内置模板。非 MAS 构建默认 `hardenedRuntime: true`。[同上 `getOptionsForFile`]
- 内置模板 `templates/entitlements.mac.plist` 含 `allow-jit`、`allow-unsigned-executable-memory`、`disable-library-validation`。[app-builder-lib 26.15.3 tarball]
- 注意：`entitlementsInherit` 同时作用于 Electron Helper、Framework 和 sidecar。若要给 sidecar 单独的 entitlements，electron-builder 没有按文件配置项，需要在 `afterSign` 中用 `codesign` 对 sidecar 重签后再签外层 `.app`，或接受与 Helper 共用。建议先共用，以免签名顺序出错。

### Bun JIT 需要的 entitlements

Bun 官方文档对编译产物推荐 5 个 entitlements：`allow-jit`、`allow-unsigned-executable-memory`、`disable-executable-page-protection`、`allow-dyld-environment-variables`、`disable-library-validation`。[Bun v1.4.2 文档 Code signing on macOS](https://github.com/oven-sh/bun/blob/bun-v1.4.2/docs/bundler/executables.mdx)。这是宽松的通用建议，不是最小集合。

Apple 说明：hardened runtime 默认禁止 `MAP_JIT` 可写可执行内存，`allow-jit` 是开启它的例外；entitlements 只加在可执行文件上，库与框架继承宿主。[Apple: allow-jit](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.allow-jit)、[Apple: Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)

实测（ad-hoc 签名 `--options runtime`，同一编译产物执行 3 亿次循环）：

| 签名方式                                                                                         | 耗时     | `numberOfDFGCompiles` |
| ------------------------------------------------------------------------------------------------ | -------- | --------------------- |
| 未加 hardened runtime（linker ad-hoc）                                                           | 1037 ms  | 1                     |
| hardened runtime，无 entitlements                                                                | 12137 ms | 1000000（JIT 不可用） |
| hardened runtime + 仅 `allow-jit`                                                                | 1077 ms  | 1                     |
| hardened runtime + `allow-jit`、`allow-unsigned-executable-memory`、`disable-library-validation` | 1075 ms  | 1                     |

结论：

- `allow-jit` 是必要且（在本测试负载下）充分的 entitlement。缺失时 **不会崩溃**，静默退化为解释器，所以验收必须包含性能或 JIT 状态断言，不能只检查能否启动。
- `Bun.serve`、`fetch`、`Bun.spawn` 在仅 `allow-jit` 下正常（实测）。
- `disable-library-validation` 对 sidecar 本身无必要（只链接系统库），但 Electron Helper 共用 inherit 文件时可能需要；`allow-dyld-environment-variables` 会允许 `DYLD_INSERT_LIBRARIES` 注入，不建议加。
- 实测签名后 `codesign --verify --strict` 通过。Developer ID 签名与公证环境下的 JIT 行为 **未验证**，应在首次真实签名构建时复测。

建议 `build/entitlements.mac.inherit.plist` 从 electron-builder 内置模板（`allow-jit`、`allow-unsigned-executable-memory`、`disable-library-validation`）开始，因为它同时作用于 Electron Helper；sidecar 在这组 entitlements 下实测正常。只有在 `afterSign` 中单独重签 sidecar 时，才收缩到仅 `allow-jit`。

### 公证

- 公证要求每个 Mach-O 都以 Developer ID Application 证书签名、启用 hardened runtime 并带 secure timestamp；可用 `codesign -vvv --deep --strict` 自查。[Apple: Resolving common notarization issues](https://developer.apple.com/documentation/security/resolving-common-notarization-issues)
- electron-builder 在 `mac.notarize` 启用时通过 @electron/notarize 2.5.0 提交，凭据从环境变量读取：API Key（`APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER`，推荐）、Apple ID 或 keychain profile。[app-builder-lib 26.15.3 `out/options/macOptions.d.ts`](https://www.npmjs.com/package/app-builder-lib/v/26.15.3)
- `@vscode/ripgrep` 的 darwin rg 只有 `linker-signed` ad-hoc 签名（实测，`TeamIdentifier=not set`），必须由我们重新签名。npm 分发若也要求 Gatekeeper 下零告警，`rukie` 与 `rg` 同样需要 Developer ID 签名；不过 npm 安装的文件没有 quarantine 属性，ADR-0023 目前不需要公证（**推断**，未在本研究中验证）。

## 5. Windows 签名

- electron-builder 在复制 `extraResources` 时对非根目录的、满足 `shouldSignFile` 的文件签名；默认规则是以 `.exe` 结尾，可用 `win.signExts` 追加（如 `.dll`）。打包后还会签 `resources/app.asar.unpacked` 中的文件。[app-builder-lib 26.15.3 `out/winPackager.js`](https://www.npmjs.com/package/app-builder-lib/v/26.15.3)
- 因此 `resources/sidecar/rukie-server.exe` 与 `rg.exe` 会自动签名，无需额外配置。
- 签名后端二选一：`win.signtoolOptions` 或 `win.azureSignOptions`（Azure Trusted Signing）。[同上 `out/options/winOptions.d.ts`]
- 自 2023 年 6 月起，OV 证书不再提供 SmartScreen 信誉，需要 EV 证书（硬件模块保存）或 Azure Trusted Signing；后者截至 2025 年 10 月仅面向美国和加拿大的组织/个人开发者。[Electron v41.0.3 code-signing](https://github.com/electron/electron/blob/v41.0.3/docs/tutorial/code-signing.md)
- Bun 的 Windows 元数据（图标、版本、发布者）不能在 macOS/Linux 上交叉编译时设置，签名本身不受影响。若需要这些元数据，要在 Windows runner 上编译 sidecar。[Bun v1.4.2 文档 Windows-specific flags]
- 首版桌面端是否支持 Windows 在 map 中未定；以上为后续参考，**均未在 Windows 上实测**。

## 6. `@electron/fuses` 的影响

- electron-builder 在 `electronFuses` 配置存在时，于打包后、签名前对 **Electron 主可执行文件**（`<productName>.app` / `.exe`）调用 `flipFuses`；代码注释写明“fuses MUST be flipped right before signing”。[app-builder-lib 26.15.3 `out/platformPackager.js`](https://www.npmjs.com/package/app-builder-lib/v/26.15.3)
- Fuses 是 Electron 二进制里的位，由签名防止被改回。[Electron v41.0.3 fuses](https://github.com/electron/electron/blob/v41.0.3/docs/tutorial/fuses.md)。它们不作用于 sidecar，sidecar 也不依赖 Electron 的任何运行能力，所以所有 fuse 都可以按 Electron 安全建议设置，不会破坏 sidecar：
  - `runAsNode: false`：禁用后 `child_process.fork` 不可用，官方推荐改用 utilityProcess。sidecar 是独立 Bun 可执行文件，用 `spawn` 拉起，不受影响。
  - `enableNodeOptionsEnvironmentVariable: false`、`enableNodeCliInspectArguments: false`、`enableEmbeddedAsarIntegrityValidation: true`、`onlyLoadAppFromAsar: true`、`grantFileProtocolExtraPrivileges: false`：均只影响 Electron 进程。
  - `onlyLoadAppFromAsar` 只限制 app 代码来源，不禁止从 `Resources/sidecar/` 执行外部二进制。
- @electron/fuses 2.0.0 是 ESM-only、要求 Node ≥ 22.12.0；app-builder-lib 26.15.3 自身声明依赖 `@electron/fuses ^1.8.0` 并以动态 import 加载。[@electron/fuses 2.0.0](https://www.npmjs.com/package/@electron/fuses/v/2.0.0)、[app-builder-lib 26.15.3](https://www.npmjs.com/package/app-builder-lib/v/26.15.3) 的 package.json。因此使用 `electronFuses` 配置时，实际执行的是 electron-builder 解析到的 1.x，而不是 tech-stack 锁定的 2.0.0。要使用 2.0.0，需在 `afterPack` 钩子中自行调用 2.0.0 的 `flipFuses`（app-builder-lib 注释给出了这种替代方式），并且不再设置 `electronFuses`。实施时二选一，并同步 tech-stack。
- 2.0.0 的 `FuseV1Options` 枚举只有 8 项（到 `GrantFileProtocolExtraPrivileges`），Electron 41 文档已有第 9 项 `wasmTrapHandlers`。启用 `strictlyRequireAllFuses` 时需确认版本对齐。[@electron/fuses 2.0.0 `dist/config.d.ts`、Electron v41.0.3 fuses]

### sidecar 侧的等价加固

Fuses 保护不到的部分要在 Bun 编译与启动层面处理：

- `BUN_BE_BUN=1` 会让任何 Bun 编译产物变成完整 `bun` CLI。实测已签名的 hardened 产物执行 `BUN_BE_BUN=1 ./sidecar -e "..."` 能运行任意代码。这是用已签名、带 JIT entitlement 的二进制执行任意脚本的途径，与 `ELECTRON_RUN_AS_NODE` 同类。[Bun v1.4.2 文档 Act as the Bun CLI]
- `BUN_OPTIONS` 会被编译产物读取，可注入运行时参数。[Bun v1.4.2 文档 Runtime arguments via BUN_OPTIONS]
- 编译产物默认从 **当前工作目录** 加载 `.env` 和 `bunfig.toml`。实测在含 `.env` 的项目目录运行默认产物会读到项目变量；加 `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` 后不再读取。[Bun v1.4.2 文档 Automatic config loading]。对 coding agent 来说项目目录不可信（project trust），sidecar 和 npm CLI 都应关闭这两项。

建议：

- 编译 sidecar 与 CLI 时始终加 `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`。
- Electron main 拉起 sidecar 时显式构造 `env`，删除 `BUN_BE_BUN`、`BUN_OPTIONS` 及 `DYLD_*`/`NODE_OPTIONS`。这是缓解措施，不能阻止本地攻击者直接执行该二进制；Bun 目前没有类似 fuse 的编译期开关来禁用 `BUN_BE_BUN`（文档未列出，**未在 Bun 源码中确认**）。

## 待决与风险

- universal 还是分 arch 发布：sidecar lipo 的 x64 切片未验证；分 arch 构建更简单，与 npm 两个平台包对应。
- 是否让 sidecar 与 Electron Helper 共用 inherit entitlements，或在 `afterSign` 中单独重签。
- grep 的 rg 路径注入方式需要改 Agent Core 与 ADR-0023 实施（npm 发布工单 02/03），应在桌面 spec 前与 npm 发布工作统一。
- Developer ID 签名 + 公证下的 JIT、Windows 签名均需真实证书和 CI 验收；本研究没有这些前提。
