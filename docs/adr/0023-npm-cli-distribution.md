---
status: accepted
---

# coding-agent 通过 npm 分发 Bun 可执行文件，以 Release PR 控制发布

## 问题

用户需要安装并运行 Rukie 命令，而现有 private workspace 的 TypeScript 入口依赖源码仓库和外部 Bun。直接公开所有内部包会增加版本协调与 API 维护成本。自动生成版本和 Changelog 还需要明确准备发布、安装验收和写入 registry 的边界，以及部分发布成功后的恢复规则。

## 决定

公开 `@rukie/coding-agent` 命令行包，首版支持 macOS arm64/x64。主包使用 Node launcher，按平台启动编入 Bun 运行时的可执行文件；两个平台包通过精确版本的 optionalDependencies 安装。用户安装需要 Node/npm，运行 Agent Core 不需要另装 Bun。Agent Core、shared、i18n 保持私有 workspace；首版只承诺 CLI，不提供公开 SDK。

内部开发继续直接消费 TypeScript，构建时生成分发 manifest、资源和 npm tarball。产品版本由 coding-agent manifest 提供，所有发布包与用户可见版本保持一致。每个目标平台对实际安装包进行运行验收；构建成功不能代替安装验收。Headless CLI 与 TUI 保持 [ADR-0012](0012-single-coding-agent-package.md) 的共用入口与动态加载边界，Bun 运行时和 pi 复用分别沿用 [ADR-0001](0001-agent-runs-in-bun-sidecar.md) 和 [ADR-0002](0002-reuse-pi-agent-core-harness.md)。

Release Please 根据整个产品的 Conventional Commits 准备版本、Changelog 和 Release PR，由维护者合并 Release PR 决定发版。初始版本为 0.1.0；0.x 兼容变更升 patch，不兼容变更升 minor，beta 使用 next。GitHub App 创建 PR、版本 tag 和 Release，npm OIDC 负责 registry 写入。PR/main 检查、版本准备和 tag 发布使用独立 workflow。

所有平台安装验收通过后保存发布 tarball。发布阶段使用已经验收的同一份产物，先发布平台包再发布主包；正式主包经过 candidate 的 registry 安装验收后才推进 latest。发布串行，失败保留旧 latest；恢复核对已发布版本和产物身份，续发缺失包。同版本内容冲突时停止，不尝试覆盖；旧版本恢复不能意外倒退 dist-tag。

项目自有代码采用 MIT，并分发第三方许可声明。本次发布保留当前 vendored Yoga，不进行替换或来源调查。这是用户确认的范围例外，部分替代 [ADR-0005](0005-own-tui-renderer.md) 关于本次对外分发必须替换 Yoga 的条件；该 ADR 其他渲染管线决定继续有效。此例外不表示来源问题已解决，也不接受仍处于 proposed 的 [ADR-0013](0013-adopt-dsh-tui-ink.md)。

## 备选方案

- 分发 Bun JS bundle，要求用户预先安装 Bun：产物简单，但用户选择安装 npm 包后直接运行。
- 独立发布内部 workspace 包或同时提供 SDK：增加公共 API 和版本维护面，首版选择只承诺 CLI。
- 每次功能合并后立即发布：缺少集中审阅版本与发布说明的入口，选择 Release PR 控制发布时间。
- 默认 GITHUB_TOKEN 驱动同一 workflow 内的发布：可减少 GitHub App 配置，但用户选择 App 身份配合独立 PR/tag 工作流。
- 发布前改用官方 yoga-layout：与 ADR-0005 原外部分发条件一致，用户明确将该项排除在本次工作之外。

## 影响

降低用户运行环境要求并保持内部模块边界，代价是维护两个平台包、launcher、编译资源定位与平台运行验收。optionalDependencies 可被省略或安装失败，launcher 必须给出明确修复提示。发布包包含代码与运行时资源，许可声明随之维护；现有 Yoga 的来源问题不在本次解决范围。

外部 GitHub 仓库、App、npm scope 和 Trusted Publisher 配置属于真实 CI/发布前提；本地验证不证明外部服务可用。正式发布首个 npm 版本需要单独明确的操作。设计接受不表示实现或发布已经完成，实施范围及证据见 [npm 发布规格](../../.scratch/npm-release/spec.md)。
