# 06：PR/main 自动验收安装包

Status: ready-for-agent
Blocked by: 04, 05

## What to build

贡献者创建或更新 main 目标 PR 时自动获得源码和双架构安装验收结果，维护者在 main 合并后获得对应 commit 的完整检查状态与已验证 tarball。普通 CI 不向 npm 发布。

## Acceptance criteria

- [ ] PR 创建、提交更新、重开、push 到 main 和人工运行触发验证，首版不使用路径过滤漏掉内部包或构建变更。
- [ ] 固定 Bun 与依赖安装方式，执行仓库要求的完整检查，并验证开发 PR 的 Conventional Commit 标题。
- [ ] 双架构在匹配 macOS runtime 执行实际安装包的 Headless、TUI 与 provider/auth 验收；reuse fixtures 避免重复构建和完整初始化。
- [ ] 所有必要检查绑定当前 commit，成功状态不能来自无关旧 commit。
- [ ] 保存实际验证的主包/平台 tarball 及身份清单，后续发布可消费相同产物，不将源码检查代替安装验收。
- [ ] 普通 PR 验证不需要 GitHub App/npm 发布凭据，无 registry 写入权限，不触发发布。
- [ ] 检查 workflow 语法、触发与权限契约，验证失败时提供对应架构和验收场景的诊断信息。
- [ ] 提供远程仓库与必要检查配置步骤。真实 CI 需外部配置后执行；记录实际结果或明确未验证，不虚报外部成功。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 31–38、43、46–47、58。04/05 分别完成 TUI 和 provider/auth，二者都是完整安装门槛的组成部分。

## Comments

- 2026-10-07：拆分已确认。本地 workflow 契约检查和 GitHub 实际运行证据分别记录。
