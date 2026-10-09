# 发布 npm 产品版本

维护者通过产品 tag 发布 `@rukie/coding-agent` 和其精确依赖的 macOS arm64 平台包。GitHub Release 的建立、源码与安装验收、npm 写入分别有独立结果；只有 registry 安装验收通过才推进稳定主包 `latest`。

## 前提

先配置[Release PR 准备](release-preparation.md)和[CI 门槛](release-ci.md)。公开 GitHub 仓库必须拥有 npm `@rukie` scope 两个包的发布权限。工具链的固定版本见[技术栈](tech-stack.md)，工作流使用 GitHub 托管 arm64 runner；包的 `repository.url` 必须与实际 `GITHUB_REPOSITORY` 一致。

GitHub 仓库的 immutable Releases 必须关闭：准备流程先建立已发布 Release，随后本流程附加原始产物。已启用 immutable 且缺少完整原始 assets 的 Release 会在 npm 写入前失败；完整且经字节验证的原始 assets 可用于再次验收。

两个包必须先存在，随后分别配置 npm Trusted Publisher：GitHub owner、repository、workflow filename `release-publish.yml` 精确匹配；本工作流没有 GitHub Environment，因此 environment 留空。分别允许直接 `npm publish` 和 `npm dist-tag`，默认 staged publish 权限不足。官方[Trusted Publishing 配置](https://docs.npmjs.com/trusted-publishers/)说明身份字段与独立操作权限；[npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/)可核对配置。

首次建立包需要维护者另行明确授权，以经过同样验收的正式版本、public access 和显式 candidate 或 next 建立两个包，再配置上述信任。不要上传占位版本；自动工作流不以存储 npm token 回退。若首次版本已经写入 registry，保留其原始 tarball、清单和验收资料，不用重新构建的文件覆盖。当前已有版本入口会停下并要求内容核对恢复。配置后的 Trusted Publisher 必须在两天内首次成功自动发布；首次人工 bootstrap 已存在的同版本上传核对或跳过不能证明 OIDC 激活。应在下一次实际新版本自动上传时核对两个包的信任状态与 provenance，超过窗口时按 npm 提示重新配置。此激活尚未在真实 registry 验证。

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
3. 只读 job 检出准确 commit，下载完整原始 Release assets，或在该版本两包均未发布时构建一次。使用同一组文件运行完整源码检查、所有 arm64 安装场景和清单身份校验，记录本次验收 witness。
4. 单独的 contents-write job 在 npm 写入前保存两个 `.tgz`、`release-build.json`、原始 `ci-acceptance.json`。它通过 GitHub API 核对原始及本次验收的 run、attempt、commit、成功的只读 job；整个工作流此时仍可处于 in-progress。文件名或自写 audit 不能单独证明验收。
5. 只有 publish job 获得 OIDC 写权限；它核对保存的原始字节，使用隔离 npm 配置，去除继承的 npm 配置覆盖，依次上传平台包和主包。稳定版显式进入 candidate，beta 显式进入 next；主包精确依赖同版本平台包。写入阶段不构建、不 pack、不重新生成 manifest。
6. 从 registry 重新下载并核对 SHA256 与 SHA512，使用独立 fresh cache 安装精确主包版本，验证 `--help`、`--version` 和 loopback fake-provider Session。稳定版随后推进 latest；beta 保持 latest。已有更高通道版本不会被普通发布降级。

## 验证与恢复

工作流串行执行且不取消正在写 registry 的运行。GitHub Release 保留原始文件和原始验收身份，重跑生成单独的本次 witness；成功结果另附 `npm-publication-RUNID-ATTEMPT.json`。Release 存在并不表示 npm 成功。

上传、依赖安装或 Session 验收失败不会推进 latest。部分或冲突的原始 assets、没有原始 assets 的已有 registry 版本、已存在的精确版本会停止；当前入口不盲目重试、不 clobber、不 unpublish。检查原始文件和 registry 的实际状态后再选择内容核对恢复或新版本。beta 上传本身会改变 next，因此较旧 beta 在上传前停止。

本地公开操作测试使用真实 npm CLI、隔离 loopback registry、fabricated credentials 和实际安装 Session；它证明上传字节、依赖、通道和失败行为。实际 GitHub Actions、npm scope 权限、Trusted Publisher、OIDC 与 provenance 需要维护者在配置后的正式运行中核对，本地测试不宣称这些外部条件已经通过。

## 后续阅读

- [构建与安装产物](release-building.md)
- [版本准备](release-preparation.md)
- [npm 发布架构](adr/0023-npm-cli-distribution.md)
