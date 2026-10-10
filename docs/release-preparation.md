# 版本准备与 GitHub Release

维护者合并功能 PR 后，[版本准备 workflow](../.github/workflows/release-prepare.yml)等待 main push 的 CI 完成。脚本重新查询这个 SHA 的最新 CI run/attempt；失败、执行中、其他事件或旧成功均不能放行。main 已前进时，此次版本 PR 准备跳过，后续 main 的成功 CI 重新准备。

## 审阅和合并

[Release Please 配置](../release-please-config.json)把整个仓库作为一个产品收集 Conventional Commits。官方库生成产品 manifest、根 CHANGELOG.md 和自动化跟踪文件的更新。准备脚本在 GitHub API 提交前用仓库锁定的 Oxfmt 格式化生成的 Markdown，满足 Release PR 的源码约束检查。维护者在 Release PR 中审阅版本、修改发布文案，再合并 PR；普通功能合并只准备 PR。版本 PR 更新可能覆盖尚未合并的自动生成文件，文案最终修改应在最后一轮准备后进行。

产品版本唯一来源是 [coding-agent manifest](../packages/coding-agent/package.json)。`.release-please-manifest.json` 是自动化已释放版本记录，不能作为独立手工版本来源。首次没有产品 tag 时，记录的 `0.0.0` 表示未发布，官方 `initial-version` 生成首版 `0.1.0`。随后 Release PR 同时更新两者，不创建 `version.txt`，也不修改私有根 package.json 的版本。

首版历史可能使 PR body 超过 GitHub 的长度边界。官方 overflow handler 将预览替换为链接，完整官方 metadata 存入同一版本 commit 的 `release-notes.md`；完整 CHANGELOG.md 仍在 PR 中。维护者在 PR 文件中修改 release-notes.md 的文案，保留官方版本 metadata；合并后从准确 merge commit 读取最后文案，链接不会指向移动的分支。GitHub Release body 超过 125000 字符时明确停止，完整 Changelog 保留，维护者编辑发布文案后重新准备；该边界依据 [GitHub CLI 的服务端错误记录](https://github.com/cli/cli/issues/7815)，真实服务行为仍需外部验收。

0.x 中 feat/fix/perf 升 patch，`!` 或 BREAKING CHANGE 升 minor；docs/test/chore 默认隐藏且不单独生成 Release PR，带 breaking 标记时仍产生版本和不兼容说明。锁文件、内部包、构建及根文件提交都进入产品历史。历史一次批量读取，上限 5000 个 commit；超过上限明确失败，维护者审阅并增加脚本与配置的边界后重新运行，不能静默截断。

合并版本 PR 后，官方库识别其 release metadata。脚本在该 merge SHA 上再次检查自己的成功 main push CI，并确认产品版本等于 tag 版本，然后创建 `coding-agent-v<version>` 和 GitHub Release。既有 tag 必须解析到同一个 commit，否则失败；GitHub Release 创建成功后才把 PR 标为 autorelease: tagged。网络或权限失败保留 pending 状态，重跑可恢复已创建 Release 后的标签步骤。GitHub Release 创建成功不表示 npm 发布成功；后续发布流程拥有 registry 验收。

脚本将官方文件读取和历史绑定到已通过 CI 的 SHA，Git data tree 以该 commit 的 tree 为基础，新版本 commit 的 parent 固定为该 SHA。main 在准备时前进会跳过分支更新；即便写入期间前进，也不会从新 main 生成文件或 tag。PR 的独立分支仍需正常 review 和 CI，脚本不绕过 main 分支保护。

## GitHub App 设置

1. 在 GitHub 创建仅安装到此仓库的 App，授予 repository Contents: Read and write、Pull requests: Read and write、Issues: Read and write、Actions: Read-only、Metadata: Read-only。无需 webhook、organization 权限或 npm 凭据。
2. 安装 App 到目标仓库，生成 private key；将 App ID 保存为 repository variable `RELEASE_APP_ID`，PEM 保存为 Actions secret `RELEASE_APP_PRIVATE_KEY`。不要提交 PEM 或安装 token。
3. 配置 main 保护要求 [CI](../.github/workflows/ci.yml) 的 Source and installed darwin-arm64 检查通过，维护者正常审阅 Release PR。App 不需要绕过 branch protection。
4. 合并带发布变更的 PR，检查成功 main CI 后的 Release preparation 日志和 Release PR。合并 Release PR，再检查它自己成功 CI 后产生的准确 tag 与 GitHub Release。

workflow 的 GITHUB_TOKEN 只有 contents: read；短期 App installation token 在依赖安装完成后才生成，只传给准备脚本。App 创建的 PR 和 tag 可以触发后续 workflows；GITHUB_TOKEN 创建事件的递归限制不适用于 App token。精确工具版本归属见[技术栈](tech-stack.md)，官方依据见 [Release Please](https://github.com/googleapis/release-please/tree/v17.3.0) 和 [GitHub App installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)。

## beta、稳定和 1.0.0

在普通配置 PR 中给 `packages["."]` 设置 `versioning: "prerelease"`、`prerelease: true`、`prerelease-type: "beta.1"`，合并并等待成功 CI。官方策略例如从 0.1.1 生成 0.1.2-beta.1，后续 fix 生成 beta.2。非零 patch 的 beta 上出现 breaking 时，官方策略可能生成 0.2.0-beta.2，保留已有 beta counter；审阅实际 Release PR，不手算另一套递增逻辑。

稳定提升时保留 prerelease versioning，把 prerelease 改为 false；官方策略将 0.1.2-beta.2 提升为 0.1.2。合并、成功 CI 并创建稳定 Release 后，在配置 PR 中删除 versioning、prerelease 和 prerelease-type，回到默认稳定策略。

明确进入 1.0.0 时，在配置 PR 中暂时设置 `release-as: "1.0.0"`，并提供用户可见的发布提交（例如 `feat: prepare stable API`），审阅官方生成的 1.0.0 Release PR。tag 创建后立即通过普通配置 PR 删除 release-as；不要长期保留覆盖值，也不要独立修改跟踪记录。若进入 1.0.0-beta.1，可显式使用相应 release-as 再按上述 beta 策略运行。

本地实际官方库测试验证版本矩阵、GitHub 请求、固定 parent、CI 失败、移动 main 和 tag 冲突。真实 GitHub App 安装、Actions 事件触发、远程 tag/Release 和 registry 发布需要在外部设置完成后验证；本地 fake API 通过不能替代这些证据。
