# coding-agent npm 发布流程

Status: needs-info

## 目标与确认状态

用户通过 npm 安装 `@rukie/coding-agent` 后运行 `rukie`，不需要另行安装 Bun。首版支持 macOS arm64 和 x64，公开契约为命令行接口；Agent Core、shared、i18n 保持内部 workspace 包。构建、安装验收、版本准备、发布及失败恢复形成同一条可审阅的流程。

2026-10-07 的 grill-with-docs 访谈已确认本文设计。本文尚待书面规格审阅；之后编写实施计划并确认执行方式，再开始代码开发。`needs-info` 表示等待该审阅，不表示设计决策仍有未回答的问题。实现、真实 GitHub CI、npm 发布均未完成。

## 当前事实

- coding-agent 为 private workspace 包，没有版本号，`bin` 指向 `src/main.ts`；源码入口使用 Bun，依赖包含 `workspace:*`。
- Agent Core 是 private 包，版本为 `0.0.0`；WebFetch 的 User-Agent 当前读取该内部包版本。
- 参数表没有 `--help` 或 `--version`。Headless CLI 和 TUI 共用参数解析，按模式动态加载。
- 仓库没有 `.github/`、发布脚本、Changelog 或 Git remote，也没有项目 LICENSE。Conventional Commits 已由 commitlint 约束。
- bash 输出捕获通过计算出的 URL 加载 pi 内部模块；ripgrep 按平台定位外部二进制；TUI 头像从仓库 brand 目录读取；pi-ai 部分 OAuth/provider 模块使用动态加载。
- ADR-0005 对外部分发时要求替换 vendored Yoga。用户在本次访谈明确要求不处理 Yoga；范围例外由 ADR-0023 记录，不宣称来源问题已经解决。

事实来自当前 manifest、CLI 参数表、相关资源定位源码及安装的 pi 0.99.2 源码；调查未执行构建、安装或发布。

## 范围

### 纳入

- macOS arm64/x64 的独立 Bun 可执行文件、主 npm 包和两个平台 npm 包。
- launcher、运行资源定位、provider/auth 打包完整性及第三方许可声明。
- 产品版本、命令行 help/version、Release Please、Conventional Commits Changelog。
- PR/main 检查、tag 发布、人工恢复入口和 npm OIDC。
- tarball 及 registry 安装验收、失败续发和 dist-tag 推进。
- 发布使用文档、GitHub App/npm 配置步骤和本地交付证据。

### 范围边界

Linux、Windows、musl、公开 SDK、独立发布内部 workspace 包、Yoga 替换及来源调查不在本次范围。保留现有 provider/auth 能力，不为简化打包删减支持。

代码交付不包含自动建立远程仓库、写入真实凭据或正式发布首个 npm 版本。外部身份配置完成后验证真实 CI；正式 npm 发布作为单独明确的操作。包名使用权和 npm scope 权限通过外部配置核实，不能由本地构建通过推断。

## 术语

- 产品版本：coding-agent 对外分发的版本，所有发布包及用户可见版本信息一致。内部 workspace 包不获得独立发布生命周期。
- Release PR：Release Please 生成的版本与 Changelog 变更，由维护者审阅并合并以决定发布时间。
- 发布产物：从一个确定 commit 构建、打包、验证的 `.tgz` 及其校验信息；进入发布阶段后不重新构建。
- 安装验收：从 tarball 或 npm registry 安装后，在源码仓库之外通过命令入口验证可观察行为。
- CI job：GitHub Actions 中的工作单元，与 Agent Core 的 Run、Subagent、Background Job 无关。

这些术语归发布流程，不改变 CONTEXT.md 的 Session/Run 等产品领域定义。

## Implementation Decisions

### 包与运行时

发布 `@rukie/coding-agent`、`@rukie/coding-agent-darwin-arm64`、`@rukie/coding-agent-darwin-x64`。主包使用 Node launcher 提供 `rukie` 命令，通过精确版本的 optionalDependencies 声明平台包。平台 manifest 使用 `os`、`cpu` 限制安装范围；launcher 对不支持的平台或缺失的平台依赖给出可执行的错误提示。

用户安装和启动 launcher 需要 Node/npm，实际 Agent Core、Headless CLI 和 TUI 运行于编入可执行文件的 Bun。launcher 保持工作目录、环境、标准输入输出、信号与退出码，不能导致重复中断或终端恢复失效。直接执行平台二进制不需要外部 Node/Bun。

开发时保留内部包直接导出 TypeScript 的 workspace 方式。发布 manifest 在 staging 目录生成，使用 files 白名单；不携带 `workspace:*`、指向 TS 源码的 bin/exports、测试目录、用户设置、凭据或 Sessions。coding-agent 的源码入口继续服务仓库内消费者，发布包首版不提供 SDK exports。

固定构建用 Bun 版本。开发源文件与构建产物走同一条 Frontend/Session 执行路径；不能新增独立的发布版业务实现。编译产物包含 TUI 代码，但 Headless 执行不能初始化 React/renderer。

### 资源与许可

每个平台包携带对应架构的 `rg` 和头像资源；资源定位相对于已安装包或编译时嵌入位置，与用户工作目录及源码仓库路径无关。平台构建不能误用构建宿主架构的 ripgrep。

pi 的 output-capture、OAuth 和 provider 动态加载需要构建可追踪的入口或显式分发所需资源。复用锁定 pi 的现有能力，不重写输出捕获或模型适配器。对保留的能力检查打包后的加载完整性，并按协议差异选择本地模拟用例。

自有代码采用 MIT，项目 LICENSE 与完整第三方许可声明随发布包分发。Yoga 实现保持现状；按用户明确范围例外不进行替换或来源调查，许可声明不能被表述为已解决该来源问题。

### 版本和 Changelog

coding-agent 的 package manifest 是产品版本来源，初始版本 `0.1.0`。生成的发布 manifest、可执行文件版本、launcher 检查和所有平台依赖使用同一版本。Release Please 的版本记录属于自动化状态，不成为另一套手工版本来源。实际应用的 User-Agent 使用产品版本时，通过内部接口注入，不让 Agent Core 反向导入 Frontend 包。

增加 `rukie --help` 和 `rukie --version`，不要求 TTY、provider 凭据或 Session 初始化；退出码为 0。参数组合遵循共用参数解析的确定规则，更新中英文文案。

0.x 期间兼容修复、新增能力及性能优化升 patch，不兼容变更升 minor；显式决定稳定契约后进入 1.0.0。beta 使用 `-beta.N`。Release Please 配置明确表达该策略，不能沿用与确认结果不同的默认 feat/minor 规则。首版引导及 beta 切换/退出步骤记录在发布教程，并通过版本配置检查验证。

Release Please 以整个产品的仓库变更范围收集 Conventional Commits，不能只收集 coding-agent 目录而漏掉内部包、锁文件或构建配置。Changelog 按 feat/fix/perf 分组；docs/test/chore 默认隐藏，不单独触发版本发布。使用不兼容标记记录 breaking changes。开发 PR 标题检查 Conventional Commits，推荐 squash merge，使进入 main 的提交信息可解析。

Release PR 自动更新产品版本、Changelog 和自动化记录；维护者可调整 Changelog 文案。main 的普通合并只准备候选版本，不直接发布 npm。版本 tag 采用 `coding-agent-v<version>`，tag 必须对应 Release PR 合并后的确定 commit。

### Workflow 与身份

| Workflow           | 触发                                                      | 责任                                                                   |
| ------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| ci.yml             | 目标为 main 的 pull_request；push 到 main；人工运行       | 安装固定版本依赖，检查源码、版本配置、构建与安装包行为                 |
| release-please.yml | push 到 main                                              | 使用 GitHub App 创建/更新 Release PR，合并后创建 tag 和 GitHub Release |
| publish.yml        | push 匹配 coding-agent-v*；workflow_dispatch 指定已有 tag | 校验发布目标，构建、pack、验收、发布及 dist-tag 推进                   |

PR 事件覆盖 opened/synchronize/reopened；首版不加 paths 过滤。Release Please 对 main 的处理以该 commit 的必要 CI 成功为前提；不以无关联的旧成功状态放行。发布始终检出 tag 对应 commit，并独立完成发布验收，人工运行不能绕过这些条件。

GitHub App 负责 PR/tag/release，使其事件可以触发独立 CI。npm 使用 Trusted Publishing/OIDC，只在发布阶段授予必要权限。普通 PR 验证不需要发布凭据，也不发布包。发布工具与 Actions 固定到经过核实的版本或 commit；准确权限、外部配置字段和版本由实施时核实后写入教程。

发布 workflow 使用不会互相交叉更新 dist-tag 的串行机制；新的发布不能取消已经开始写 registry 的旧发布。人工恢复仅接受符合产品 tag/版本规范的既有发布目标；验证 tag 可达性、commit、版本和产物身份，不接受任意分支作为发布来源。

### 发布顺序和恢复

所有 macOS 平台的构建和 tarball 安装验收成功后，保存两个平台包及主包的 `.tgz`、版本、commit、构建工具版本和校验信息。发布阶段消费这份已经验收的产物，不重新生成 manifest 或编译二进制。

先发布两个平台包，再发布依赖它们的主包。平台包的发布不得意外推进 latest；稳定主包先进入 candidate，从 registry 安装并验收后才将主包 latest 指向该版本。beta 主包使用 next，且不修改 latest。平台包与主包的 dist-tag 操作显式指定，不能依赖 npm publish 默认值。

构建或安装验收失败不写入 registry。部分平台包已经发布时，保留旧 latest；恢复时比对 npm 已发布的完整版本产物及依赖关系，匹配后续发缺失包。相同版本存在不一致内容时停止，改用新版本；不能覆盖或未经核对就跳过。

主包已发布但 registry 验收或 tag 推进失败时，从对应发布产物和 registry 状态恢复验收与推进。避免较旧恢复操作将 latest/next 倒退；明确的人工回退使用单独的操作步骤。正式版 registry 验收完成后补齐 GitHub Release 的产物和验证信息；Release Please 已创建的 Release 本身不证明 npm 已发布成功。

## 验收要求

### 本地与 tarball

- 在隔离目录和临时 HOME 中安装实际 `.tgz`，通过安装后的 `rukie` 命令运行；测试不依赖 workspace 链接、源码路径、真实用户设置或外部 Bun。
- 验证 help/version、参数错误、退出码、stdin、text/stream-json 与中断行为。
- 通过本地 fake provider 驱动实际 Session Run，验证 grep 使用分发的 rg、bash 输出捕获和清理、Session Resume；保留 Agent Core 安全默认和权限规则。
- 在 PTY 中验证 TUI 启动、退出、信号及终端恢复，检查头像资源可达。必要的终端断言复用现有公共测试入口。
- 逐项覆盖保留的 provider/auth 的构建后加载路径；针对不同协议使用本地模拟。真实远程认证/模型连通性单独记录为未验证，不以加载成功替代。
- 检查包文件列表、许可文件、精确平台依赖、版本一致性；阻止 workspace:*、源码入口和构建宿主绝对路径进入分发契约。
- launcher 覆盖不支持的平台、缺失 optionalDependencies、信号转发和退出状态，包含有空格的安装路径。

### CI 与 registry

- arm64 和 x64 都在匹配架构的 macOS runtime 上实际执行验收；交叉编译成功不能代替运行验收。可用 runner 与外部账号能力在真实 CI 配置时核实。
- 所有平台验收完成才进入有写权限的发布阶段；记录实际发布的 `.tgz` 身份与对应验证结果。
- registry 验收从已发布的精确版本安装主包，确认平台依赖、命令版本和代表性 Session 行为，再推进稳定主包 latest。
- 发布恢复使用本地 registry 模拟覆盖部分成功、同版本冲突、主包验收失败、tag 推进失败、重试及旧版本恢复，不通过测试写入真实 npm registry。
- 无 real provider 凭据、GitHub App 或 npm 权限的本地交付不得报告真实 CI、OAuth 登录或 npm 发布成功。

## 文档与实施准备

规格审阅通过后，将实施拆分为依赖有序的编号票：产品版本与命令入口、构建资源与平台产物、安装包验收、Release Please/CI、发布恢复与文档。具体文件和公开测试入口在实施计划中按当前源码确定，不在尚未审阅的阶段创建 ready-for-agent 实施票。

发布教程提供维护者日常 Release PR 流程、首次 npm 包/Trusted Publisher 建立步骤、GitHub App 与 remote 绑定、beta/稳定版本切换、失败恢复和回退。包 README 面向安装和使用者。技术版本只在 docs/tech-stack.md 维护；维护文档在实现后描述实际可用行为。

## ADR Coverage

| 决定或修改                              | 归属                                                                                                                                | 理由                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Bun 编译产物运行 Agent Core 与 Frontend | 沿用 [ADR-0001](../../docs/adr/0001-agent-runs-in-bun-sidecar.md)                                                                   | 保留 Bun 生产运行时，不迁移到 Node Agent Core   |
| pi 能力与构建资源适配                   | 沿用 [ADR-0002](../../docs/adr/0002-reuse-pi-agent-core-harness.md)                                                                 | 复用锁定 harness，适配分发方式，不另写业务实现  |
| 唯一 CLI 与 Headless/TUI 动态加载       | 沿用 [ADR-0012](../../docs/adr/0012-single-coding-agent-package.md)                                                                 | 分发只改变交付载体，保留 Frontend 运行边界      |
| 产品版本、平台包、发布身份及可恢复发布  | 新增 [ADR-0023](../../docs/adr/0023-npm-cli-distribution.md)                                                                        | 对外安装和自动发布契约需要长期维护              |
| 本次不处理 Yoga                         | [ADR-0023](../../docs/adr/0023-npm-cli-distribution.md) 部分替代 [ADR-0005](../../docs/adr/0005-own-tui-renderer.md) 的外部分发条件 | 用户明确范围例外，其余渲染管线决定继续有效      |
| help/version、本地化与许可清单          | 无需独立 ADR                                                                                                                        | 局部命令入口和分发配套；不改变 Session 领域语义 |

## Comments

- 2026-10-07：用户确认第一轮五项推荐；第二轮平台改为仅 macOS，其余推荐确认；第三轮要求不处理 Yoga，MIT 和保留 provider/auth 确认；最终完整设计确认。当前阶段为书面规格审阅，代码尚未实施。
- 2026-10-07：书面规格自审完成，核对了全部访谈决定、ADR Coverage、平台与包版本、候选标签、GitHub Release 与 npm 成功状态、恢复行为及外部配置边界。没有新增 Session 领域术语或运行实现。文档验证通过：`bun run docs:update`、`bun run check:docs`（44 个维护 Markdown 文件）、`bun run check:scratch`、四个修改文件的 `oxfmt --check` 和 `git diff --check`；本阶段未运行代码测试、构建或发布。
