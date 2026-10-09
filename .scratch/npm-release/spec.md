# coding-agent npm 发布流程

Status: ready-for-agent

## Problem Statement

用户希望通过 npm 安装 Rukie 后直接运行命令，而当前 coding-agent 是依赖源码仓库与外部 Bun 的 private workspace 包。开发者没有统一的编译、安装包验收、版本与 Changelog 生成、CI 触发、npm 发布和失败恢复流程，无法证明发布包在普通用户环境中可用，也无法可靠地重复发版。

现有源码具有动态加载模块、外部 ripgrep 二进制及头像资源，直接编译或发布 workspace manifest 不能证明资源可用。对内部包分别公开发布还会扩大公共接口与版本维护范围。

## Solution

提供公开命令行包 `@rukie/coding-agent`，用户使用 Node/npm 安装后运行 `rukie`，无需另行安装 Bun。首版只支持 macOS arm64（Apple Silicon），通过主包 launcher 启动对应平台的独立 Bun 可执行文件；内部 workspace 包保持私有。

维护者合并普通开发 PR 后，由 Release Please 自动整理整个产品的 Conventional Commits，更新包含版本与 Changelog 的 Release PR。维护者审阅并合并 Release PR 后创建版本 tag，触发构建、打包、arm64 安装验收和 npm 发布。正式主包先进入 candidate，经 registry 安装验收后推进 latest；beta 使用 next。失败保留旧 latest，并可核对产物后恢复。

交付发布脚本、CI 与 Release Please 配置、文档及本地验证证据。外部 GitHub App、npm scope 和 Trusted Publisher 完成配置后验证真实 CI；首个正式 npm 发布作为单独明确的操作。

## User Stories

1. As a macOS arm64 user, I want to install Rukie through npm, so that I can use it without checking out its source repository.
2. （延后，见 Out of Scope）As a macOS x64 user, I want an executable built for my architecture, so that I can run Rukie without an architecture mismatch.
3. As a Rukie user, I want installation to require only Node and npm, so that I do not have to install Bun separately.
4. As a Rukie user, I want the installed package to expose the rukie command, so that I can start it from my terminal.
5. As a Rukie user, I want to run the command from any project directory, so that installation paths do not determine where I can work.
6. As a Rukie user, I want installation paths containing spaces to work, so that my filesystem layout does not break startup.
7. As a Rukie user, I want help output without credentials or a TTY, so that I can discover usage before configuration.
8. As a Rukie user, I want version output without initializing a Session, so that I can identify the installed release quickly.
9. As a Rukie user, I want invalid arguments to produce clear errors and deterministic exit codes, so that automation can detect misuse.
10. As a Headless CLI user, I want text output from the installed command, so that I can use it in existing scripts.
11. As a Headless CLI user, I want stream-json output, so that integrations can consume structured Session events.
12. As a Headless CLI user, I want piped stdin to reach the actual Session, so that I can submit input from other commands.
13. As a Headless CLI user, I want interruption to stop work with the expected exit behavior, so that cancellation works in automation.
14. As a TUI user, I want the installed command to start the interactive interface, so that I can work without the development environment.
15. As a TUI user, I want normal exit and interruption to restore my terminal, so that subsequent commands remain usable.
16. As a TUI user, I want the shipped avatar resource to remain available, so that installation preserves the intended presentation.
17. As a Rukie user, I want grep to use the correct shipped ripgrep binary, so that search works without a separate installation.
18. As a Rukie user, I want bash output capture and cleanup to work after packaging, so that execution remains observable and resources are released.
19. As a Rukie user, I want to resume persisted Sessions, so that packaging does not disrupt my workflow.
20. As a Rukie user, I want existing provider and auth capabilities preserved, so that distribution does not reduce supported integrations.
21. As a Rukie user, I want package and executable versions to agree, so that diagnostics identify one product release.
22. As a Rukie user, I want a clear error for a missing platform package, so that I can repair installation.
23. As a user on an unsupported platform, I want an explicit support message, so that I understand the platform boundary.
24. As a Rukie user, I want to upgrade through latest, so that default installation selects an accepted stable release.
25. As a beta user, I want to install through next, so that I can try prereleases without changing the stable channel.
26. As a maintainer, I want one product version shared by all packages, so that I do not coordinate independent internal releases.
27. As a maintainer, I want internal workspace packages kept private, so that CLI distribution does not create a public SDK commitment.
28. As a maintainer, I want generated release manifests, so that package metadata cannot drift between platforms.
29. As a maintainer, I want a package file whitelist, so that tests, credentials, settings and Sessions stay out of artifacts.
30. As a maintainer, I want MIT and third-party notices shipped, so that recipients can inspect the declared terms.
31. As a maintainer, I want fixed build tool versions, so that evidence identifies the artifact toolchain.
32. As a maintainer, I want tarball tests outside the repository, so that workspace links cannot hide missing resources.
33. As a maintainer, I want every supported architecture tested on a matching runtime, so that cross-compilation is not execution evidence.
34. As a maintainer, I want local model fixtures and isolated configuration, so that tests spend no API credits and alter no real Sessions.
35. As a maintainer, I want packaged provider and auth loading checked, so that one fake-provider Run does not hide omitted adapters.
36. As a contributor, I want checks on PR creation and updates targeting main, so that regressions are caught before merge.
37. As a maintainer, I want main checked after merge, so that release preparation uses the integrated commit.
38. As a contributor, I want Conventional Commit titles validated, so that squash commits drive predictable notes.
39. As a maintainer, I want Changelog generation across the whole product, so that internal package changes are included.
40. As a maintainer, I want an automatically maintained Release PR, so that I can review versions and edit release wording.
41. As a maintainer, I want ordinary merges to prepare releases without publishing, so that I control release timing.
42. As a maintainer, I want an explicit pre-1.0 version policy, so that compatible and breaking changes receive agreed increments.
43. As a maintainer, I want tags to identify exact commits, so that artifacts trace back to reviewed code.
44. As a maintainer, I want App-created PRs and tags to trigger workflows, so that automation does not stop at event boundaries.
45. As a maintainer, I want npm OIDC publishing, so that routine CI needs no stored long-lived npm token.
46. As a maintainer, I want all platform tests to pass before registry writes, so that unverified architectures are not published.
47. As a maintainer, I want to publish the tested tarballs, so that later rebuilds cannot invalidate verification.
48. As a maintainer, I want platform packages published first, so that main package dependencies exist when users install it.
49. As a maintainer, I want candidate installation verified before latest changes, so that broken candidates do not replace stable releases.
50. As a maintainer, I want serialized publication, so that releases cannot interleave channel updates.
51. As a maintainer, I want matching existing packages recognized during recovery, so that partial releases can continue.
52. As a maintainer, I want conflicting existing versions to stop publication, so that retries cannot conceal inconsistent artifacts.
53. As a maintainer, I want failures to preserve the previous latest, so that users retain a working stable default.
54. As a maintainer, I want old recovery attempts to avoid channel regression, so that retries cannot undo newer releases.
55. As a maintainer, I want explicit recovery and rollback instructions, so that failures do not require improvised procedures.
56. As a maintainer, I want GitHub Release evidence to distinguish tags from npm success, so that delivery status is accurate.
57. As a maintainer, I want precise external setup instructions, so that I can bind the repository and publishers without committing credentials.
58. As a maintainer, I want separate local, CI and npm evidence, so that unverified external behavior is visible.

## Implementation Decisions

1. 分发边界为一个 CLI 产品：公开 `@rukie/coding-agent` 与一个 macOS arm64 平台包，所有发布包使用同一版本；Agent Core、shared、i18n 不单独公开发布。
2. 主包 Node launcher 根据平台与架构定位二进制。平台包使用 os/cpu 限制及精确版本 optionalDependencies；不支持的平台（含 macOS x64）或缺失依赖产生明确提示。平台包机制保持可扩展，后续增加架构只新增平台包与验收，不改 launcher 契约。
3. Agent Core 与 Frontend 运行在编入二进制的 Bun。launcher 保持工作目录、环境、标准 IO、信号和退出状态，避免重复中断及终端恢复失效；直接执行平台二进制不需要外部 Node/Bun。
4. 内部开发继续使用 workspace TypeScript 入口。构建生成 staging manifest 和 tarball，采用文件白名单，排除 workspace 依赖声明、源码入口、测试和用户数据，不新增发布版业务执行路径。
5. 固定 Bun 构建版本，保留共用参数解析与 Headless/TUI 动态加载边界。产物可包含 TUI 代码，但 Headless 不初始化 React/renderer。
6. 携带对应架构的 ripgrep 和头像，不依赖用户工作目录、源码路径或构建宿主架构。ripgrep 作为平台包内与可执行文件同目录的独立文件分发，编译产物按 `realpath(process.execPath)` 所在目录定位，源码运行继续经 `@vscode/ripgrep` 解析；编译产物以构建期常量区分，不依赖 Bun 虚拟文件系统路径。头像等只读资源可嵌入可执行文件。
7. 编译产物关闭 `.env` 与 `bunfig.toml` 自动加载：工作目录是不受信任的用户项目，项目文件不得改变产品运行时配置或预加载代码。
8. 对 pi 输出捕获、OAuth/provider 动态加载使用构建可追踪入口或明确资源分发，保留锁定 pi 能力及现有支持范围，不另写模型适配器或输出捕获业务。
9. coding-agent manifest 是产品版本来源，初始 0.1.0；生成 manifest、二进制、launcher、平台依赖及可见版本一致。Release Please manifest 仅记录自动化状态。产品版本进入 Agent Core 的应用 User-Agent 时通过内部接口注入，不反向导入 Frontend。
10. 增加 help/version 入口，无 TTY、无凭据即可成功返回且不初始化 Session。共用解析入口定义参数组合规则，并更新中英文文案。
11. 0.x 兼容修复、新增能力和性能优化升 patch，不兼容变更升 minor；稳定契约确认后进入 1.0.0。beta 使用 beta.N 后缀，显式配置策略并记录首版引导、beta 进入和退出步骤。
12. Release Please 从整个产品的 Conventional Commits 生成 Release PR，包含内部包、锁文件和构建变更。Changelog 展示 feat/fix/perf 与不兼容变更，docs/test/chore 默认隐藏且不单独发版。检查开发 PR 标题，推荐 squash merge。
13. Release PR 更新版本、Changelog 和自动化状态，维护者可调整文案。普通合并不直接发布 npm；Release PR 合并后创建 coding-agent-v 加产品版本的 tag，固定发布 commit。
14. 普通 CI 对 main 目标 PR 的创建、更新、重开以及 main push、人工运行触发，不加 paths 过滤。版本准备由 main push 触发，依赖该 commit 必要 CI 成功，不使用无关旧状态。
15. 发布由产品版本 tag 或人工指定已有 tag 触发，检出准确 commit 并验证 tag、版本、可达性和产物身份。人工恢复不绕过验收，也不接受任意分支。
16. GitHub App 创建 PR/tag/Release 并触发独立 workflow；npm OIDC 负责 registry 写入，仅发布阶段有写权限。普通 PR 不需要发布凭据。工具与 Actions 固定为核实过的版本或 commit。
17. arm64 实际安装验收通过后，保存所有 tarball 及版本、commit、工具版本和校验信息。发布消费这份产物，不重新构建、pack 或生成 manifest。
18. 发布串行，不取消正在写 registry 的旧发布。先发平台包后发主包；所有 publish/dist-tag 操作显式指定标签，避免提前改变 latest。
19. 稳定主包先进入 candidate，registry 精确版本安装验收成功后推进主包 latest。beta 使用 next，不改变 latest，稳定验收不覆盖 beta next。
20. 构建或 tarball 验收失败不写 registry。部分成功的恢复核对已发布内容、依赖及身份，匹配则续发缺失包，冲突则停止并改用新版本。
21. 主包发布后的恢复核对原产物与 registry 状态，再执行验收或标签推进；旧恢复不能意外倒退 latest/next，人工回退另有明确操作。GitHub Release 创建不代表 npm 成功，最终补齐产物及实际验证信息。
22. 自有代码采用 MIT，携带项目许可与第三方声明。按用户明确指示保留 Yoga，本次不替换、不调查来源；范围例外不表示来源问题解决。
23. 外部仓库、App、npm scope 权限及 Trusted Publisher 是真实 CI/发布前提，本次提供配置步骤，不读取或提交真实凭据。配置后验证真实 CI，首个正式 npm 发布需单独明确执行。
24. 构建、安装验收、版本准备和恢复各有明确责任与公开操作入口。使用者文档覆盖安装与命令，维护者教程覆盖配置、发布、恢复和回退；技术版本与架构决定遵循既有文档归属。

## Testing Decisions

### 已确认的测试入口

Q8 与最终完整设计已确认安装包验收；Q13 确认 provider/auth 打包完整性。本次沿用确认，不新增产品侧测试接口，也不重新访谈。

主要入口是安装后的 rukie 命令：在仓库外安装真实 tarball，临时 HOME 和项目目录隔离配置，通过正常用户设置连接本地 fake provider，以子进程运行。断言 argv/stdin、终端输入、模型 HTTP 请求、stdout/stderr、退出状态和持久化 Transcript，不向编译产物加入测试专用业务入口。

发布恢复通过公开发布操作连接可控本地 registry，使用隔离地址与认证环境验证实际上传、读取、安装和 dist-tag 状态。测试不镜像每次 npm 调用，也不向真实 npm 上传测试版本。这是外部发布协议边界，与产品 Session 的命令入口分别承担责任。

### Observable behavior

- tarball 和 registry 安装后都能运行，启动不借助 workspace 链接、源码路径或外部 Bun。控制产品子进程 PATH；测试 harness 使用 Bun 不代表产品依赖外部 Bun。
- 覆盖 help/version、参数错误、中英文输出、缺失 optionalDependencies、不支持的平台、空格路径、标准 IO、text/stream-json、中断与退出状态。
- 本地 fake provider 驱动实际 Session Run，验证分发的 ripgrep、bash 输出捕获及清理、取消、Session Resume 和持久化事实，保持权限及 project trust 语义。
- 真实 PTY 验证安装产物 TUI 的启动、输入、退出、中断和终端恢复，确认头像可用。分发涉及的 resize/小终端取代表性场景，其他交互沿用既有覆盖。
- 验证安装后的 provider/auth 加载路径，协议不同的路径使用本地模拟；真实远程 OAuth 与模型连通性单列外部验证，不以加载成功替代。
- 检查真实 tarball 的白名单、许可、架构、版本、依赖和身份，这是分发契约，不是内部 helper 实现断言。
- 验证版本/Changelog 对兼容功能、修复、性能、不兼容标记、隐藏提交和 beta/稳定切换的结果，内部包变更必须进入产品发布范围。
- 验证普通 PR/main 不发布，tag/恢复使用准确版本，版本准备依赖当前 commit 的 CI，全部架构通过才发布，发布消费已验收 tarball。
- 本地 registry 覆盖部分成功、匹配既有版本、同版本冲突、主包验收失败、标签推进失败、重试、旧版本恢复与显式回退，断言包内容及 latest/next/candidate 状态。

### Prior art and verification cost

现有 [Headless CLI e2e](../../packages/coding-agent/tests/headless/e2e/cli.test.ts) 使用临时配置、[fake OpenAI 服务](../../packages/coding-agent/tests/headless/helpers/fake-openai.ts) 和子进程验证输出、工具与持久化。发布验收复用其协议及隔离方式，将执行目标换为安装后的命令。

现有 TUI [app start](../../packages/coding-agent/tests/tui/helpers/app.ts) 使用公共入口、controlled model、可观察 terminal 与完成信号；[startWithClock](../../packages/coding-agent/tests/tui/helpers/clock-app.ts) 提供同进程虚拟时钟。局部源码回归复用它们，安装产物仍走 PTY，不把源码调用视为发布验收。

使用 bun:test，以外部行为、事件、终端谓词、进程退出及持久化结果断言。等待有诊断性超时，固定等待不是同步；父进程假时钟不能驱动产品或 npm 子进程。真实 transport/runtime 等待只覆盖必要契约并记录理由。

arm64 在实机上验收，交叉编译不代替运行。复用构建与安装 fixtures，用少量端到端场景验证 wiring，较多恢复组合放在 registry 边界，不反复启动完整 TUI。记录超过一秒用例的必要成本，优先移除可避免的等待与重复初始化。

开发期间运行最小相关测试，最终代码状态运行一次全量 check 并复用结果。文档阶段只运行文档、tracker、格式及 diff 检查。分别记录本地、真实 CI、registry 安装与真实远程认证的状态。

## Out of Scope

- Linux、Windows、musl 和 macOS 之外的平台。
- macOS x64（Intel）平台包：当前没有匹配的 x64 runtime（本机 arm64 未装 Rosetta，尚无 CI runner），首版不构建、不发布；x64 Mac 运行时得到明确的不支持提示。具备匹配 runtime 后另行扩展。
- 公开 SDK、独立发布内部包及重写 Frontend/Session 执行路径。
- Yoga 替换和来源调查，采用用户明确确认的本次范围例外。
- 因打包方便而缩减现有 provider/auth 支持。
- 自动创建远程仓库、替用户决定 scope 所有权、读取或提交真实凭据。
- 外部配置完成前宣称真实 CI、OAuth 登录或 npm 发布成功。
- 未经单独明确操作就正式发布首个 npm 版本。

## Further Notes

2026-10-07 的 grill-with-docs 访谈及最终设计已确认全部决策。用户随后调用 to-spec，要求按标准模板发布到本地 tracker，因此状态为 ready-for-agent，不继续保留书面规格等待状态。本次整理不表示脚本、workflow、真实 CI 或 npm 发布已经完成。

当前调查包括 private workspace TS 入口、产品版本与 help/version 缺失、内部 Agent Core 版本、pi 动态资源、ripgrep 和头像定位，以及 Git remote、CI、Changelog、项目 LICENSE 缺失。实施前核对实际源码与外部工具，不把调查当作外部服务验证。包名和 scope 发布权限须实际账号配置证明。

具体文件组织与实施顺序由后续编号实施票确定。本规格保留需求、接口与验收契约，避免将易变文件路径写入 Implementation Decisions。

## ADR Coverage

| 决定或修改                                                           | 归属                                                                                                                 | 理由                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Bun 编译产物运行 Agent Core 与 Frontend                              | 沿用 [ADR-0001](../../docs/adr/0001-agent-runs-in-bun-sidecar.md)                                                    | 保留 Bun 生产运行时            |
| pi 能力与资源适配                                                    | 沿用 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)                                                     | 复用锁定 harness               |
| 唯一命令、动态加载及 CLI-only                                        | 沿用 [ADR-0012](../../docs/adr/0012-single-coding-agent-package.md)                                                  | 保持 Frontend 边界             |
| 产品版本、平台包、身份和恢复                                         | [ADR-0023](../../docs/adr/0023-npm-cli-distribution.md)                                                              | 长期对外分发契约               |
| 冻结历史/文件的官方 Release Please 规划、精确 PR parent/merge CI/tag | [ADR-0023](../../docs/adr/0023-npm-cli-distribution.md)                                                              | 发布准备绑定不可变 commit      |
| 原资产/模块清单审计与独立当前验收见证                                | [ADR-0023](../../docs/adr/0023-npm-cli-distribution.md)                                                              | 产物身份及验收边界             |
| 内容核对恢复、未知写入协调、单调通道和显式 rollback                  | [ADR-0023](../../docs/adr/0023-npm-cli-distribution.md)                                                              | 已确认恢复与人工回退契约       |
| 本次不处理 Yoga                                                      | [ADR-0023](../../docs/adr/0023-npm-cli-distribution.md) 部分替代 [ADR-0005](../../docs/adr/0005-own-tui-renderer.md) | 用户明确范围例外，其余决定有效 |
| 当前固定来源 ink/Yoga 与分发许可边界                                 | 沿用 [ADR-0013](../../docs/adr/0013-adopt-dsh-tui-ink.md)                                                            | 保留既有来源及本次范围例外     |
| help/version、本地化及许可清单                                       | 无需独立 ADR                                                                                                         | 不改变 Session 领域语义        |
| 首版仅 macOS arm64                                                   | 更新 [ADR-0023](../../docs/adr/0023-npm-cli-distribution.md)                                                         | 缩小首版平台范围               |
| ripgrep 旁置定位与 Bun 自动加载关闭                                  | 沿用 [ADR-0023](../../docs/adr/0023-npm-cli-distribution.md)                                                         | 属于既定编译产物资源与运行边界 |

## Comments

- 2026-10-07：第一轮五项推荐确认；第二轮平台改为仅 macOS；第三轮 Yoga 排除，MIT 与保留 provider/auth 确认；完整设计确认。原设计提交为 3598ed1。
- 2026-10-07：原设计文档、tracker、格式与 diff 检查通过；未执行代码测试、构建或发布。
- 2026-10-09：用户决定首版只支持 macOS arm64，x64 移入 Out of Scope；03 改为产物身份与平台边界，04–06、08 的双架构验收改为 arm64。
- 2026-10-09：桌面端 sidecar 打包调研（`.scratch/desktop/research/sidecar-packaging.md`）在 Bun 1.4.2 编译产物上实测：`import("@vscode/ripgrep")` 因 `/$bunfs` 路径必然失败，嵌入的 `rg` 无法 `posix_spawn`；产物默认从 cwd 加载 `.env` 与 `bunfig.toml`。据此修正实现决定 6（去掉“嵌入资源”定位 ripgrep）并新增 7，后续编号顺延；02、03 验收同步。桌面 sidecar 复用同一布局与定位。
- 2026-10-07：按 to-spec 整理标准模板，保留已确认测试入口，补齐 58 条用户故事，更新为 ready-for-agent；不重新访谈或创建重复规格。

- 2026-10-09：09 实施后的 ADR Coverage 已复核：产品版本与 Release PR、tarball/平台身份、实际内容恢复、原资产审计及独立 rollback 属于 ADR-0023；唯一命令/动态加载沿用 ADR-0012，当前 pi harness 沿用 ADR-0024，固定来源 ink/Yoga 沿用 ADR-0013。本次 Yoga 范围例外与 CLI-only 保持，无公开 SDK、平台扩展或新的 auth 面。父规格继续开放，最终两轴审阅和唯一聚合检查由主协调线程完成；本地证据不替代真实 CI/registry/OIDC。
