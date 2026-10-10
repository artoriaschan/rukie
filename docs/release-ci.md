# 配置源码与 npm 安装包 CI

[CI workflow](../.github/workflows/ci.yml) 为 main 目标 PR、main push 和人工运行执行源码检查与 macOS arm64 安装验收。成功运行保存实际验收过的 tarball 和身份清单，供后续流程按准确提交消费。

## 前提

将仓库推送到实际 GitHub remote，并将默认分支设为 main。在仓库 Actions 设置中允许工作流使用固定提交的 checkout、setup-node、setup-bun、download-artifact 与 upload-artifact。工具链版本由 [CI workflow](../.github/workflows/ci.yml) 固定；依赖通过 `bun install --frozen-lockfile` 安装。首版 runner 为 GitHub-hosted `macos-15`，工作流会检查宿主确实是 darwin-arm64；其他架构不在当前支持范围。

普通 CI 的 token 只有 `contents: read`，checkout 不保留凭据。此工作流不配置 GitHub App、npm token、OIDC 或 registry 写入权限。Fork PR 可以执行相同验收，但不获得发布身份。仓库尚未建立实际 remote 或远程 CI 配置时，本地检查不能证明 GitHub 已运行成功。

## 启用与配置必要检查

1. 推送含 workflow 的提交到 main，确认 Actions 页面出现名为 `CI` 的工作流。main push 会运行；也可以从 main 人工运行。PR 的创建、提交更新和重开刷新完整验收，没有路径过滤。[PR 标题工作流](../.github/workflows/pr-title.yml)独立响应这些事件及 PR 编辑；修改标题或描述只刷新标题检查，不重启完整验收。
2. 建立 main 分支 ruleset 或保护规则，要求 PR 合并前通过 `Source and installed darwin-arm64` 和 `Conventional Commit PR title` 检查，并要求分支与 main 保持最新。检查来源选择此仓库的 GitHub Actions；不要用另一个提交的旧成功状态放行。首次成功运行后，GitHub 才能在设置中提供相应检查名称。
3. 创建一个 main 目标 PR，使用符合 Conventional Commits 的标题，例如 `fix(cli): preserve installed cancellation`。标题失败时修改标题，只需等待标题检查通过；源码或安装验收失败时修复并提交，等待新提交的完整验收成功。PR 标题通过环境变量传给仓库已锁定的 commitlint，不进入 shell 源码。
4. 合并后核对 main push 的准确 SHA 对应 CI 成功。PR 验收默认针对 GitHub 的临时 merge commit，main 验收针对 push commit；两者不是同一份源码身份。若人工运行其他分支，其成功记录也不能替代 main push 门槛。

启用了 merge queue 的仓库需要先扩展当前 workflow 的 `merge_group` 验收，再启用队列；当前触发配置针对普通 PR 合并。CI 按 PR 或分支取消被新运行替代的旧验收；取消、失败或尚未完成的运行不提供可消费的成功产物。

## 核对产物

CI 将输出写入 runner 的临时目录，先构建一次，再以当前 `GITHUB_SHA` 和 clean metadata 运行[产物身份验证](release-building.md#核对产物身份)。`RUKIE_RELEASE_ARTIFACTS` 让全部产物、Headless、TUI 和 provider/auth 测试复用这些 tarball；完整检查包含实际 npm 离线安装、隔离 HOME 和假协议服务。验收不读取真实用户凭据，也不请求真实 provider。实际 provider/OAuth 服务可用性与此本地协议证明不同。

源码约束由构建 job 执行一次 `bun run check:dev`。随后[共用测试工作流](../.github/workflows/release-tests.yml)用 Bun 原生 `--shard=N/6 --timings=scripts/test-timings.json` 按历史耗时分配全部测试文件，六个独立的标准 macOS runner 各设置 `RUKIE_TEST_WORKERS=1`。耗时较长的发布恢复、资产与安装场景参与同一套耗时分配，避免集中到一个 runner；文件是分配的最小单位，单个用例的超时仍须单独诊断。每个分片下载同一份候选 tarball，并核对准确源码提交和产物身份。所有分片成功后，最终验收 job 才生成审计与成功产物；任一失败或取消都会阻止发布。候选产物保留一天，不携带新验收记录。本地完整检查默认仍用四个 worker；复现某个分片时运行 `RUKIE_TEST_WORKERS=1 env -u NO_COLOR bun run test --shard=1/6 --timings=scripts/test-timings.json`，并提供同一份 `RUKIE_RELEASE_ARTIFACTS`。

[耗时基线](../scripts/test-timings.json)使用 Bun 的 version 1 格式，以仓库相对测试路径映射到毫秒。初始值来自 CI run `38035281713` 的三个完整分片日志，按每个文件的用例耗时求和，作为分配估计而非性能门槛；未记录的新文件仍由 Bun 纳入分配。所有分片必须读取同一份基线。更新时使用准确提交、相同工具链和安装产物执行各分片，在临时目录用 `--timings=PATH --update-timings` 保存实测文件耗时，收齐所有分片后合并 `files` 并通过 PR 更新仓库基线；不要在 CI 中直接改写受版本控制的文件。

源码约束日志保存为 `source-check-static-RUN_ID-RUN_ATTEMPT`，每个测试分片日志保存为 `source-check-shard-N-RUN_ID-RUN_ATTEMPT`，均保留一天。Actions 页面成功时显示最后八行，失败时显示最后一百二十行；查看具体断言与上下文时下载对应完整日志。测试失败仍会阻止审计和成功产物上传。

完整检查完成后，[审计脚本](../scripts/release/ci-audit.ts) 再次检查源码 HEAD、源码干净状态及 tarball 身份，生成 `ci-acceptance.json`。它记录仓库、run id、run attempt、event、提交、平台、构建清单与模块清单的 SHA-256 和每个包的 digest。单独调用审计脚本不会执行源码测试；消费者还必须核对对应 CI run 成功。

成功运行上传名为 `rukie-darwin-arm64-SHA-RUN_ID-RUN_ATTEMPT` 的 artifact，保存 14 天，内容为两个 `.tgz`、`release-build.json`、`release-modules.json` 和 `ci-acceptance.json`。下载时指定准确 workflow run 和 attempt，核对审计中的身份及模块清单哈希，使用 `release:verify --require-clean --commit EXPECTED_SHA` 验证 tarball。模块清单供下载后的完整 provider/auth 安装验收复用；不重新构建清单来替代原始证据。不要以 artifact 的显示名称或过期成功状态代替身份核对。runner 的 staging 树、测试 HOME 与 Session 数据不会上传。

## 本地验证与恢复

从 macOS arm64 仓库根目录构建并验证安装包，命令见[分发教程](release-building.md)。`bun run release:accept --artifact-dir PATH` 运行产物身份、Headless、TUI 与 provider/auth 的完整安装验收；它与源码完整检查分别承担安装行为和仓库整体约束。

workflow 的本地契约测试为 `bun test scripts/release/tests/workflows.test.ts`，包括触发范围、权限、准确提交、单次构建复用、成功后上传和标题命令的数据边界。另用官方 actionlint 1.7.12 检查 YAML、Actions 输入与表达式上下文；下载固定 release 并核对官方 SHA-256 后执行 `actionlint .github/workflows/ci.yml .github/workflows/pr-title.yml`。此静态验证不触发 CI，也不证明 runner、App 或 npm 的外部配置成功。

构建失败时查看 `Build the installed artifacts once`；身份失败查看 `Verify clean source and artifact identity`；源码或具体安装行为失败查看 `Test shard N of 6` 中的测试名称。检查意外改写受版本控制的文件或产生未跟踪文件时，审计步骤会拒绝保存成功身份。修复源码后重新运行对应提交，不复用失败运行的 tarball。artifact 过期后在准确提交重新验收，不能把新提交的构建冒充旧提交。
