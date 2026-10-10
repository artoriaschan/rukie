# 研究：本地 macOS arm64 ad-hoc 签名 `.app` 的打包细节

回答 [工单 17](../issues/17-research-packaging-details.md)。只覆盖本地构建的 macOS arm64 ad-hoc 签名 `.app`（[03](../issues/03-mvp-scope.md#comments) 2026-10-10），不涉及 Developer ID、公证、CI、Windows、x64 和 universal。在 [工单 11 研究](sidecar-packaging.md) 基础上补充。

版本基线：Electron 41.0.3、electron-builder 26.15.3（app-builder-lib 26.15.3，依赖 @electron/osx-sign 1.3.3）、Bun 1.4.2（实测 `bun --version` = 1.4.2）、@vscode/ripgrep-darwin-arm64 1.18.0（`rg --version` = ripgrep 15.0.0）。实验机器为 macOS 27.0.1（26A434），arm64。

来源：

- app-builder-lib 26.15.3 npm tarball：`out/macPackager.js`（`sign()`）、`out/mac/MacTargetHelper.js`（`handleNullIdentity`、`findSigningIdentity`、`buildSignOptions`、`getOptionsForFile`）、`out/codeSign/macCodeSign.js`（`isSignAllowed`、`findIdentity`、`reportError`）、`out/platformPackager.js`（`afterSign` 触发条件）、`out/options/macOptions.d.ts`（`identity` 说明）、`templates/entitlements.mac.plist`。
- @electron/osx-sign 1.3.3 npm tarball：`dist/cjs/sign.js`（`signApplication`）。
- 仓库：`packages/agent/src/tools/grep.ts`、`scripts/release/build.ts`、`docs/release-building.md`。
- 2026-10-10 本机实验（标“实测”）：最小 electron-builder 工程，内含 `bun build --compile` sidecar 与 rg，`--mac dir --arm64` 构建。未使用钥匙串证书，构建时设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`，未修改 Gatekeeper 系统设置。

## 结论

1. 配置 `mac.identity: "-"`。electron-builder 会经 osx-sign 对 `Contents/` 下所有 Mach-O 由深到浅执行 `codesign --sign - --force --timestamp --options runtime`，`Resources/sidecar/` 中的 sidecar 和 rg 也在内，最后签外层 `.app`，`codesign --verify --deep --strict` 通过。`identity: null` 和“未设置且找不到证书”都会跳过签名，`afterSign` 也不执行；这时外层 bundle 没有资源封印，strict 校验失败。（阅读 + 实测）
2. ad-hoc 签名加 hardened runtime 后，Electron 需要 `disable-library-validation`，否则主进程加载 Electron Framework 时被 dyld 拒绝。sidecar 只需 `allow-jit` 就能保持 JIT：hardened runtime 加 `allow-jit` 约 1.0 s；hardened runtime 无 `allow-jit` 约 6.3 s，`numberOfDFGCompiles` 为 1000000；不加 hardened runtime 约 1.0 s。（实测）
3. 建议在 `afterSign` 中重签 sidecar（只带 `allow-jit`）和 rg（不带 entitlements），然后用 `--preserve-metadata` 重新封印外层 `.app`。Helper 继续使用 inherit entitlements。（实测可行）
4. JIT 验证：构建脚本先检查 sidecar 签名 flags 包含 `runtime`、entitlements 含 `allow-jit`，再执行 `BUN_BE_BUN=1 <sidecar> -e <probe>`，断言 `numberOfDFGCompiles(f) !== 1000000`。耗时比只作参考，不作门槛。（实测）
5. 本机构建的文件没有 `com.apple.quarantine`，只有 `com.apple.provenance`。直接执行和 `open` 都能启动。`spctl --assess` 对 ad-hoc 签名的 app 一律返回 `rejected`，与是否有 quarantine 无关，所以它不能作为本地验收项。手动加上 quarantine 后，首次从 shell 执行被 SIGKILL（退出码 137）。（实测）
6. sidecar 可以直接复用 grep.ts：编译时同样定义 `RUKIE_COMPILED=true`，`realpath(process.execPath)` 指向 `Contents/Resources/sidecar/rukie-sidecar`，同目录的 rg 能找到并执行。rg 必须来自锁定的 `@vscode/ripgrep-darwin-arm64`；Homebrew 的 rg 依赖 `/opt/homebrew` 的 pcre2，在 hardened runtime 下无法加载。（实测）

## 1. electron-builder 在无证书时的签名路径

### `identity` 三种取值（阅读）

`macPackager.sign()` 先调用 `isSignAllowed()`（非 darwin 或 PR 构建时返回 false），之后按 `config.identity` 分支：

| `mac.identity` | 行为                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `null`         | `handleNullIdentity()` 打印 `skipped macOS code signing`，返回 false；若设置了 `forceCodeSigning` 则抛错                                                     |
| 未设置         | 在钥匙串中查找 Developer ID 等证书；找不到时 `reportError` 跳过签名，没有自动 ad-hoc 回退（`macOptions.d.ts` 原文：“there is no automatic ad-hoc fallback”） |
| `"-"`          | 证书查找失败后构造 `Identity("-")`，走正常签名流程。hardened runtime 开启时打印警告，提示需要 `disable-library-validation`                                   |

`"-"` 分支仍会运行 `security find-identity` 列出身份，这是只读操作。`platformPackager.js` 只有在 `signApp` 返回 true 时才发出 `afterSign`；否则对用户注册的 `afterSign` 打印 “skipping "afterSign" hook as no signing occurred”。

### osx-sign 的签名方式（阅读）

`signApplication` 先 `walkAsync(Contents/)` 收集二进制，再追加 `binaries`，按路径深度从深到浅排序，最后签 `.app`。每个文件执行 `codesign --sign - --force --timestamp [--options runtime] --entitlements <plist> <file>`。entitlements 由 `getOptionsForFile` 决定：`.app` 本身用 `entitlements`，其余文件（Helper、Framework、`Resources/sidecar/*`）用 `entitlementsInherit`；都未配置时回退到 `build/entitlements.mac[.inherit].plist`，再回退到内置模板（`allow-jit`、`allow-unsigned-executable-memory`、`disable-library-validation`）。非 MAS 构建默认 `hardenedRuntime: true`。按文件定制 entitlements 只能用 `signIgnore` 或自定义 `sign`；配置项本身不支持。

### 签名结果（实测）

`identity: "-"`，`entitlements` 与 `entitlementsInherit` 都使用内置模板内容：

```text
R17.app                                    flags=0x10002(adhoc,runtime)  Sealed Resources version=2 files=12
R17.app/Contents/Frameworks/R17 Helper.app flags=0x10002(adhoc,runtime)
Resources/sidecar/rukie-sidecar            flags=0x10002(adhoc,runtime)  [allow-jit, allow-unsigned-executable-memory, disable-library-validation]
Resources/sidecar/rg                       flags=0x10002(adhoc,runtime)  [同上]
TeamIdentifier=not set（全部）
codesign --verify --deep --strict R17.app  → valid on disk / satisfies its Designated Requirement
```

`identity: null`：Electron 主程序保持 Electron 发布时的 `adhoc,linker-signed`，sidecar 保持 Bun 链接器写入的 `adhoc,linker-signed`（无 runtime），rg 保持原有签名。从 shell 运行正常，JIT 有效，但 `codesign --verify --deep --strict` 报错 `code has no resources but signature indicates they must be present`。

arm64 上 Mach-O 至少需要 ad-hoc 签名：用 `codesign --remove-signature` 去掉 sidecar 的签名后执行，被内核 SIGKILL（退出码 137）。Bun 编译产物和 `@vscode/ripgrep` 的 rg 本身已带 linker-signed ad-hoc 签名，所以 `identity: null` 也能运行，但不能保证 bundle 封印完整。

## 2. hardened runtime 下的 JIT

基准为 sidecar 内 3 亿次整数循环。Electron main 用 `child_process.spawn` 拉起 sidecar，读取 stdout 后 `app.exit`。外层 `.app` 始终使用内置模板加 hardened runtime，只改变 sidecar 的签名（实测）：

| sidecar 签名                                        | benchMs | `numberOfDFGCompiles` |
| --------------------------------------------------- | ------- | --------------------- |
| electron-builder 默认（runtime + 模板三项）         | 935     | 1                     |
| runtime + 仅 `allow-jit`（`afterSign` 重签）        | 962     | 1                     |
| runtime + 仅 `disable-library-validation`（无 JIT） | 6322    | 1000000               |
| 无 hardened runtime（`codesign -s - -f`）           | 974     | 1                     |
| `identity: null`（linker-signed）                   | 995     | 1                     |

本机在无 JIT 时慢约 6.5 倍（工单 11 用另一负载测得约 12 倍）。缺少 `allow-jit` 时进程照常退出 0，只是变慢，因此必须做第 4 节的检查。用 `BUN_JSC_useJIT=0` 运行未重签的 linker-signed 产物也得到 6096 ms / 1000000，可见 1000000 是 JIT 不可用时的稳定信号（实测；未在 JSC 源码中确认该值的定义）。

Electron 本身：外层与 Helper 只带 `allow-jit`、不带 `disable-library-validation` 时，`codesign --verify --deep --strict` 仍然通过，但启动时报 `Library not loaded: @rpath/Electron Framework.framework/Electron Framework … code signature … not valid for use in process`，退出码 134。原因是 ad-hoc 签名没有 Team ID，library validation 无法匹配 Framework（实测，与 electron-builder 警告一致）。因此 `entitlements` 与 `entitlementsInherit` 必须保留 `disable-library-validation`。

## 3. sidecar 的 entitlements：沿用 inherit 还是 `afterSign` 重签

| 方案                       | 结果                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 沿用 `entitlementsInherit` | 无需额外代码；sidecar 与 rg 都获得 `allow-unsigned-executable-memory` 和 `disable-library-validation`，rg 还获得 `allow-jit` |
| `afterSign` 重签（推荐）   | sidecar 只有 `allow-jit`，rg 没有 entitlements；多一个约 15 行的钩子，需要重新封印外层                                       |

推荐 `afterSign`。sidecar 执行模型生成的命令，并持有凭据；`disable-library-validation` 会让它加载任意未签名 dylib，而它只链接系统库，用不到这项权限。rg 也不需要任何 entitlement。重签后的布局与日后接入 Developer ID 时一致。前提是 `identity: "-"`，否则 `afterSign` 不执行。

实测可用的钩子：

```js
// afterSign：在 electron-builder 完成 ad-hoc 签名后收紧 sidecar 资源的 entitlements
exports.default = async (ctx) => {
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  const dir = path.join(app, "Contents/Resources/sidecar");
  const sign = (args) => execFileSync("codesign", ["--sign", "-", "--force", ...args]);
  sign([
    "--options",
    "runtime",
    "--entitlements",
    "build/sidecar.entitlements.plist",
    path.join(dir, "rukie-server"),
  ]);
  sign(["--options", "runtime", path.join(dir, "rg")]);
  // 嵌套代码的签名改变后，外层封印失效，需要重签外层；不加 --deep，以免覆盖 Helper 和 Framework 的签名
  sign(["--options", "runtime", "--preserve-metadata=entitlements,identifier,flags", app]);
  execFileSync("codesign", ["--verify", "--deep", "--strict", app]);
};
```

只重签 sidecar、不重签外层时，`codesign --verify --deep --strict` 报 `a sealed resource is missing or invalid`（实测）。重签外层后，外层 entitlements 保持模板三项，sidecar 只剩 `allow-jit`，rg 无 entitlements，strict 校验通过，JIT 与 rg 正常（实测）。

另一种做法未实测：在 `extraResources` 之前先签好 sidecar，再用 `signIgnore` 排除 `Resources/sidecar/`。这样不必重新封印外层，但要依赖 `signIgnore` 正则与路径约定。

## 4. 本地构建脚本的 JIT 验证

建议在 electron-builder 之后增加 `verify` 步骤，全部针对 `.app` 内的实际文件：

1. `codesign --verify --deep --strict <app>`。
2. 对 `Resources/sidecar/rukie-server` 执行 `codesign -d --entitlements - --xml`，断言含 `com.apple.security.cs.allow-jit`；`codesign -dv` 的 flags 含 `runtime`。rg 的 flags 含 `runtime`，且没有 entitlements。
3. 运行时探针，不需要在 sidecar 中加入专用模式：

```sh
BUN_BE_BUN=1 "$APP/Contents/Resources/sidecar/rukie-server" -e '
const { numberOfDFGCompiles } = require("bun:jsc");
function f(n) { let s = 0; for (let i = 0; i < n; i++) s = (s + i * 7) % 1000003; return s; }
f(3e7);
const n = numberOfDFGCompiles(f);
if (n === 1000000) { console.error("JIT unavailable"); process.exit(1); }'
```

实测对照（3000 万次循环）：默认签名 101 ms / 1，无 `allow-jit` 563 ms / 1000000，无 hardened runtime 101 ms / 1，`identity: null` 99 ms / 1。entitlements 绑定在可执行文件上，所以从 shell 执行的结果与 Electron 拉起的结果一致（两种方式实测一致）。

`BUN_BE_BUN` 是工单 11 记录的加固缺口；Electron main 拉起 sidecar 时会删除它，构建脚本借用它是有意的。如果日后用编译选项禁用了该能力，就改为 sidecar 的隐藏自检参数，判据不变。`BUN_JSC_useJIT=0` 等 `BUN_JSC_*` 变量在编译产物中同样生效（实测），可以用来构造负例，验证这个检查确实会失败。

## 5. Gatekeeper 与 quarantine

- 本机构建的 `.app`、sidecar 和 rg 都没有 `com.apple.quarantine`，只有 `com.apple.provenance`（`xattr -lr`，实测）。quarantine 由下载应用或 AirDrop 等写入，本地构建不会产生。
- 无 quarantine 时，直接执行 `Contents/MacOS/<name>` 和 `open -W <app>` 都能启动，sidecar JIT 正常（实测）。
- `spctl --assess -vv --type execute` 对 `.app` 和 sidecar 都返回 `rejected`，有无 quarantine 结果相同；`syspolicy_check distribution` 报 “Adhoc Signed App … not suitable for distribution”（实测）。spctl 判断的是 app 能否通过分发策略，不代表本机能否运行，本地验收不应包含它。
- 手动给 `.app` 副本写入 quarantine（`0081;<time>;Safari;`）后，从 shell 执行主程序被 SIGKILL（137）；`xattr -d com.apple.quarantine` 后可以运行（实测）。之后同一副本重新写入 quarantine，又能运行，推测 syspolicyd 缓存了该代码的放行结果（实测现象，原因未确认）。
- Finder 双击被 quarantine 的 ad-hoc app 时出现的系统对话框和“仍要打开”流程未实测，因为这需要交互并会产生系统放行记录。结论：本机构建、本机使用无需任何 Gatekeeper 操作；若把 `.app` 或 `.dmg` 经下载、AirDrop 等方式传到其他位置，需要 `xattr -dr com.apple.quarantine <app>`，或在系统设置中手动放行。

## 6. rg 查找复用 grep.ts

- `grep.ts` 在 `RUKIE_COMPILED` 为 true 时使用 `join(dirname(await realpath(process.execPath)), "rg")`；该常量由 `scripts/release/build.ts` 通过 `define: { RUKIE_COMPILED: "true" }` 注入（阅读）。sidecar 的编译脚本需要同样注入。
- 实测 `.app` 内 sidecar 的 `process.execPath` 为 `…/R17.app/Contents/Resources/sidecar/rukie-sidecar`，同目录 rg 可执行，`rg --version` 正常。在 hardened runtime 签名、`afterSign` 收紧和 `identity: null` 三种情况下都成立。
- rg 来源必须是锁定的 `@vscode/ripgrep-darwin-arm64` 1.18.0（只链接 `libiconv`、`libSystem`）。Homebrew rg 链接 `/opt/homebrew/opt/pcre2/lib/libpcre2-8.0.dylib`，在 hardened runtime 且无 `disable-library-validation` 时报 `different Team IDs` 并无法启动；在没有 Homebrew 的机器上任何签名方式下都无法运行（实测前者，后者为推断）。
- grep.ts 编译产物的 `ripgrep-unavailable` 提示目前写的是“npm 平台包不完整、重新安装 optionalDependencies”，对桌面端并不准确；查找逻辑可以直接复用，但提示文案需要另行处理。

## 7. 实验记录

工程位于 `/tmp/rukie-research-17-app`，结束后已删除。`ps` 中没有残留的 R17、sidecar 或 Electron 实验进程。

```sh
bun install                                   # package.json 固定 electron 41.0.3、electron-builder 26.15.3
bun build --compile --target=bun-darwin-arm64 \
  --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  sidecar-src/main.ts --outfile dist-sidecar/rukie-sidecar
cp …/@vscode/ripgrep-darwin-arm64/bin/rg dist-sidecar/rg
CSC_IDENTITY_AUTO_DISCOVERY=false bunx --no electron-builder --config eb-adhoc.yml --mac dir --arm64
```

`eb-adhoc.yml` 要点：`extraResources: [{ from: dist-sidecar/, to: sidecar/, filter: [rukie-sidecar, rg] }]`，`mac: { identity: "-", target: dir, entitlements, entitlementsInherit }`。变体包括 `identity: null`、无 `disable-library-validation`、`afterSign`。构建日志关键行：

```text
• ad-hoc signing with hardenedRuntime enabled requires the com.apple.security.cs.disable-library-validation entitlement …
• signing  file=out-adhoc/mac-arm64/R17.app platform=darwin type=distribution identityName=- identityHash=none
• skipped macOS notarization  reason=`notarize` options were unable to be generated
```

sidecar 输出示例（默认签名）：

```json
{
  "bun": "1.4.2",
  "execPath": "…/R17.app/Contents/Resources/sidecar/rukie-sidecar",
  "rgOk": true,
  "rgVersion": "ripgrep 15.0.0 (rev 3a612f88b8)",
  "benchMs": 1002,
  "dfgCompiles": 1
}
```

Electron main 的 spawn 外层耗时（wallMs）约为 benchMs 加 15 ms。`bun:jsc` 在 1.4.2 中没有 `jscOptions` 导出，无法直接读取 `useJIT` 选项，因此采用 `numberOfDFGCompiles` 作为信号。
