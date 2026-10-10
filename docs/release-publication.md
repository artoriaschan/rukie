# 发布 npm 产品版本

维护者通过产品 tag 发布 `@rukie/coding-agent` 和其精确依赖的 macOS arm64 平台包。GitHub Release 的建立、源码与安装验收、npm 写入分别有独立结果；只有 registry 安装验收通过才推进稳定主包 `latest`。

## 前提

先配置[Release PR 准备](release-preparation.md)和[CI 门槛](release-ci.md)。公开 GitHub 仓库必须拥有 npm `@rukie` scope 两个包的发布权限。工具链的固定版本见[技术栈](tech-stack.md)，工作流使用 GitHub 托管 arm64 runner；包的 `repository.url` 必须与实际 `GITHUB_REPOSITORY` 一致。

GitHub 仓库的 immutable Releases 必须关闭：准备流程先建立已发布 Release，随后本流程附加原始产物。已启用 immutable 且缺少完整原始 assets 的 Release 会在 npm 写入前失败；完整且经字节验证的原始 assets 可用于再次验收。

两个包必须先存在，随后分别配置 npm Trusted Publisher：GitHub owner、repository、workflow filename `release-publish.yml` 精确匹配；本工作流没有 GitHub Environment，因此 environment 留空。分别允许直接 `npm publish` 和 `npm dist-tag`，默认 staged publish 权限不足。官方[Trusted Publishing 配置](https://docs.npmjs.com/trusted-publishers/)说明身份字段与独立操作权限；[npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/)可核对配置。

首次建立包需要维护者另行明确授权，以经过同样验收的正式版本、public access 和显式 candidate 或 next 建立两个包，再配置上述信任。不要上传占位版本；自动工作流不以存储 npm token 回退。若首次版本已经写入 registry，保留其原始 tarball、清单和验收资料，不用重新构建的文件覆盖。重跑会下载原始产物、核对 registry 实际字节后跳过匹配版本；没有可信原始产物的已有版本会停止。配置后的 Trusted Publisher 必须在两天内首次成功自动发布；首次人工 bootstrap 已存在的同版本上传核对或跳过不能证明 OIDC 激活。应在下一次实际新版本自动上传时核对两个包的信任状态与 provenance，超过窗口时按 npm 提示重新配置。此激活尚未在真实 registry 验证。

## 首次包建立

首次包建立是独立的正式 registry 写入，需要维护者明确授权和自己的 npm scope 权限。可以先运行选定 tag 的 publication workflow，让只读验收及原始资产保存完成；尚无 Trusted Publisher 时预期 npm 自动写入失败。随后从该 Release 下载已保存的原始文件，检出同一 tag，核对完整身份和可信验收 job，按[分发教程](release-building.md)复验原始文件；不能为 bootstrap 另行 pack。

在上述外部授权后，维护者通过 `npm login` 登录具有两个包 public publish 权限的账户，使用自己的 MFA 完成首次建立。以下是稳定版0.1.0的示例，只能使用该 tag 保存并验收的原始文件；beta 将 candidate 改为 next。

```sh
npm publish ./rukie-coding-agent-darwin-arm64-0.1.0.tgz --access public --tag candidate --ignore-scripts
npm publish ./rukie-coding-agent-0.1.0.tgz --access public --tag candidate --ignore-scripts
npm view @rukie/coding-agent@0.1.0 optionalDependencies --json
```

核对主包精确依赖平台0.1.0后，在两个已存在包的 Settings 配置上述 Trusted Publisher。人工建立不会将稳定版变成 latest，也不会激活自动发布身份；内容核对恢复必须再完成 registry 安装验收才推进通道。下一次真正上传新版本时核对两包自动发布是否在激活窗口内成功，不将重复版本核对当作 OIDC 上传证明。本仓库没有执行这些正式操作。

## 操作

1. 合并经 CI 校验的 Release PR，由准备流程产生 `coding-agent-vVERSION` tag。tag 对应的 commit 必须可从 `origin/main` 到达，且其提交内产品版本与 tag 完全相同。
2. tag push 启动 [publication workflow](../.github/workflows/release-publish.yml)。人工入口必须让 workflow 本身也运行于选定 tag，例如 `gh workflow run release-publish.yml --ref coding-agent-v0.1.0 -f tag=coding-agent-v0.1.0`。从默认 main 手工触发并填写另一个 tag 会失败；workflow SHA、provenance 和源码 commit 必须相同。
3. 只读 job 检出准确 commit，下载完整原始 Release assets，或在该版本两包均未发布时构建一次。源码约束检查后，[四个测试分片](release-ci.md#核对产物)下载同一组文件，运行全部源码测试、arm64 安装场景和清单身份校验；所有分片成功后才记录本次验收 witness。
4. 单独的 contents-write job 在 npm 写入前保存五份原始资产：两个 `.tgz`、`release-build.json`、`release-modules.json`、原始 `ci-acceptance.json`。它通过 GitHub API 核对原始及本次验收的 run、attempt、commit、成功的只读 job；整个工作流此时仍可处于 in-progress。文件名或自写 audit 不能单独证明验收。
5. 只有 publish job 获得 OIDC 写权限；它核对保存的原始字节，使用隔离 npm 配置，去除继承的 npm 配置覆盖，依次上传平台包和主包。稳定版显式进入 candidate，beta 显式进入 next；主包精确依赖同版本平台包。写入阶段不构建、不 pack、不重新生成 manifest。
6. 从 registry 重新下载并核对 SHA256 与 SHA512，使用独立 fresh cache 安装精确主包版本，验证 `--help`、`--version` 和 loopback fake-provider Session。稳定版随后推进 latest；beta 保持 latest。已有更高通道版本不会被普通发布降级。

## 验证与恢复

工作流串行执行且不取消正在写 registry 的运行。GitHub Release 保留原始文件和原始验收身份，重跑生成单独的本次 witness；成功结果另附 `npm-publication-RUNID-ATTEMPT.json`。Release 存在并不表示 npm 成功。

上传、依赖安装或 Session 验收失败不会推进 latest。模块清单是实际构建的 sanitized embedding evidence，位于 npm tarball 外；audit 的 `releaseModulesSha256` 将其与同一次验收身份绑定。恢复下载该原清单，不重建或重新生成；它不替代实际 tarball 校验或远程 auth 证据。普通 CI 与发布 workflow 都保留同一清单。完整原始 assets 的重跑先重新执行准确 tag 的全部只读验收，保留原 ci-acceptance.json 并生成单独 current-acceptance.json。逐包核对 name/version、repository、平台与 engines、安装入口、依赖及 npm scripts 等安装身份，并 fresh 下载实际 tarball，比较原始 SHA256 和 SHA512；只有匹配才跳过。所有已有包的核对先于任何缺失包上传，同版本冲突要求新版本修复，不能覆盖或 unpublish。

部分原始 assets、空 starter 上传或缺少原始 assets 的已有 registry 版本会停止，不能用重构建替换身份。恢复完整原始文件后重跑同一个已有 tag，例如 `gh workflow run release-publish.yml --ref coding-agent-v0.1.0 -f tag=coding-agent-v0.1.0 -f operation=publish`。读取401、503、无效 JSON 或 tarball 下载失败是未知状态，不是版本不存在；检查权限、网络与实际状态后再重跑。仅 registry 的404或完整合法 packument 中确实缺少目标版本表示当前不存在。

npm 非零退出也可能发生在服务器已接收 PUT 之后。脚本立即重新读取实际版本和字节，匹配则继续，仍缺失则停止并要求核对后重跑；不根据退出码盲目重复 PUT。标签响应丢失时同样重新读取实际 dist-tags：已经到目标则完成，未到目标则停止，后续重跑仍先核对内容和执行 registry 安装验收。npm 隐式 fetch 重试关闭，由这些状态核对拥有恢复。

如果平台上传成功而主包失败，重跑匹配平台后只续发主包；两包已存在而 Session 验收失败，重跑不上传，重新 fresh-cache 安装与 Session 验收。验收成功但 latest 推进失败时仍基于同一组原始文件重跑。普通旧 stable 恢复可保留或上传 candidate，但不会降低已有更高 latest；候选标签不是 stable 用户默认。beta publish 本身修改 next，因此只要已有更高 main/platform next 且缺少任一目标包，就在所有上传前停止；完整匹配旧 beta 可以重新验收并报告 superseded，保持更新的 next。稳定版不覆盖 next，beta 不覆盖 latest。

本地公开操作测试使用真实 npm CLI、隔离 loopback registry、fabricated credentials 和实际安装 Session；它证明上传字节、依赖、通道和失败行为。实际 GitHub Actions、npm scope 权限、Trusted Publisher、OIDC 与 provenance 需要维护者在配置后的正式运行中核对，本地测试不宣称这些外部条件已经通过。

## 明确人工回退

回退是独立的 workflow operation，必须人工选择已存在、完整且可信的旧产品 tag。示例：`gh workflow run release-publish.yml --ref coding-agent-v0.1.0 -f tag=coding-agent-v0.1.0 -f operation=rollback`。这不是普通恢复的 force 开关；它共享同一 publication concurrency，仍检查准确 tag/commit、全部源码及 arm64 安装场景、本次成功 witness、原始资产和 registry 双包字节，并 fresh-cache 验证实际命令与 Session。

rollback 不构建、不 pack、不上传包；缺少原始 assets 或任一 registry 包就停止。版本为稳定版时只将主包 latest 指向该完整旧版本，beta 时只改变主包 next；另一个通道保持原状，平台选择仍由主包精确版本依赖决定。结果记录 operation、previousVersion、目标版本和通道；普通 publish 恢复始终保留单调通道规则。单独手工修改 dist-tag 不属于该流程的并发控制，维护者应避免同时从外部写同一通道。

## 本地与外部证据

本地实际最低消费者工具链 Node24.15.0/npm11.21.0 已通过34个安装场景，包括 Headless、PTY、provider 和 MCP；较多 registry 恢复状态通过真实 npm 与真实存储字节/通道验证，代表性恢复和 rollback 使用独立 cache 的实际安装 Session。其余等价状态在公开 acceptance callback 边界注入完成/失败，避免反复启动 TUI。稳定和 beta 版本在各自临时源码、Git、锁定依赖根中构建，不修改共享 checkout 或添加产品测试参数。

此证据证明本地实现，不证明真实 GitHub App、Actions、npm OIDC/provenance 或正式 registry 写入。正式首发仍需单独明确操作；所有配置条件与真实运行结果应分别记录。原 npm tarball 的 provenance 使用同一 tgz SHA512，Sigstore metadata 是单独附件，不会改变已验收 tgz 的字节。

## 后续阅读

- [用户安装与升级](installation.md)
- [构建与安装产物](release-building.md)
- [版本准备](release-preparation.md)
- [npm 发布架构](adr/0023-npm-cli-distribution.md)
