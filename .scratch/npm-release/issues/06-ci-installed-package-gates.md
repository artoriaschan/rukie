# 06：PR/main 自动验收安装包

Status: resolved
Blocked by: 04, 05

## What to build

贡献者创建或更新 main 目标 PR 时自动获得源码和 arm64 安装验收结果，维护者在 main 合并后获得对应 commit 的完整检查状态与已验证 tarball。普通 CI 不向 npm 发布。

## Acceptance criteria

- [x] PR 创建、提交更新、重开、push 到 main 和人工运行触发验证，首版不使用路径过滤漏掉内部包或构建变更。
- [x] 固定 Bun 与依赖安装方式，执行仓库要求的完整检查，并验证开发 PR 的 Conventional Commit 标题。
- [x] arm64 在 macOS arm64 runner 执行实际安装包的 Headless、TUI 与 provider/auth 验收；reuse fixtures 避免重复构建和完整初始化。
- [x] 所有必要检查绑定当前 commit，成功状态不能来自无关旧 commit。
- [x] 保存实际验证的主包/平台 tarball 及身份清单，后续发布可消费相同产物，不将源码检查代替安装验收。
- [x] 普通 PR 验证不需要 GitHub App/npm 发布凭据，无 registry 写入权限，不触发发布。
- [x] 检查 workflow 语法、触发与权限契约，验证失败时提供对应架构和验收场景的诊断信息。
- [x] 提供远程仓库与必要检查配置步骤。真实 CI 需外部配置后执行；记录实际结果或明确未验证，不虚报外部成功。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 31–38、43、46–47、58。04/05 分别完成 TUI 和 provider/auth，二者都是完整安装门槛的组成部分。

## Comments

- 2026-10-09：首版只支持 macOS arm64，双架构要求改为 arm64，见父规格 Out of Scope。
- 2026-10-07：拆分已确认。本地 workflow 契约检查和 GitHub 实际运行证据分别记录。

- 2026-10-09：实现 `.github/workflows/ci.yml`。main 目标 PR opened/synchronize/reopened/edited、main push 与 workflow_dispatch 无路径过滤触发，contents:read、checkout 不保留凭据，无 App/npm/OIDC 身份。固定 Actions commit、Bun 1.4.2、Node 24.15.0、npm 11.21.0、frozen lockfile 和 checksum 校验的 actionlint 1.7.12。PR 标题只通过环境变量传给已有 commitlint。
- 2026-10-09：macos-15 单 job 检查真实 darwin-arm64 宿主与 checkout SHA；在 runner 临时目录构建一次，require-clean/expectedSHA 校验，`RUKIE_RELEASE_ARTIFACTS` 供完整 check 复用全部安装测试。完整检查后 `ci-audit.ts` 再核对当前源码干净状态、HEAD、tarball，写入 run/repository/attempt/event/metadata digest 身份。只上传实际 tgz、release-build.json、ci-acceptance.json；审计脚本单独运行不声称执行了源码检查。`release:accept` 已覆盖产物、Headless、TUI、provider/auth 四套验收。
- 2026-10-09：TDD 从缺失 workflow 和缺失审计 CLI 的公开边界失败开始；workflow/公开 CLI 契约测试 4 pass、37 assertions、228ms。实际 shell 中的 commitlint 将 `$(touch ...)` PR 标题作为字面数据，不执行标题；错误 GITHUB_SHA 被拒绝。真实 YAML 通过 actionlint 1.7.12。scripts tsc、oxlint、Knip、docs:update/check:docs、format/diff checks 通过。审计正路径以独立外部 synthetic example/rukie/run123 fixture 验证，未声称真实 CI 身份。
- 2026-10-09：提交 34b7c120fd1fab7a872e3a0c8f6cc850075476c4 的 clean 产物 `/tmp/rukie-release-06-clean` 一次构建（5360ms，compile211ms），严格 require-clean/expectedSHA 验证通过；Bun1.4.2、本地 Node26.10.0、隔离 npm11.21.0/HOME。完整 `release:accept` 34 pass、0 fail、222 assertions、26.28s，复用同组 tarball；真实 PTY Sixel、Kitty、退出恢复与 MCP OAuth fake server 是必要子进程/协议成本。此本地 Node 与 CI 固定 Node24.15.0 区分，远程 CI 工具链尚未执行。未运行 aggregate check，根代理在全部票完成后执行一次。
- 2026-10-09：`docs/release-ci.md` 提供实际 remote、Actions 设置、main 必要检查、严格更新与准确 run/attempt artifact 消费步骤。实际仓库 remote/CI 尚未配置；无真实 GitHub CI/App/tag/npm/OAuth 服务证明，未读取身份或发布。ADR coverage 复用 ADR-0023 分发与 ADR-0012 npm 产品边界；CI 执行现有验收，不改变 Session/pi-durable 或 Yoga 来源例外，无需新增 ADR。
