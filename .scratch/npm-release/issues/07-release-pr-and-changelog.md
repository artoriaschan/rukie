# 07：自动版本、Changelog 与 Release PR

Status: resolved
Blocked by: 06

## What to build

main 的必要检查成功后，维护者获得自动更新的 Release PR，集中审阅产品版本和完整 Changelog；合并该 PR 后由 GitHub App 创建准确版本 tag 和 GitHub Release，触发独立发布流程。

## Acceptance criteria

- [x] main push 驱动 Release Please，以该 commit 的必要 CI 成功为前提；无关旧成功状态或失败状态不能放行。
- [x] 从整个产品的 Conventional Commits 收集变更，包括内部包、锁文件和构建；不只扫描 coding-agent 目录。
- [x] 自动维护 Release PR 的产品版本、Changelog 和跟踪状态，维护者可以审阅并调整发布文案；普通功能合并不直接发布 npm。
- [x] 明确实现首版 0.1.0、0.x 兼容变更升 patch、不兼容变更升 minor，以及 beta.N/稳定切换；说明显式进入 1.0.0 的操作。
- [x] Changelog 展示 feat/fix/perf 和不兼容变更，docs/test/chore 默认隐藏且不单独触发版本发布。
- [x] 配置结果通过代表性提交与版本场景验证，产品 manifest 和自动化跟踪状态不会形成互相漂移的手工版本来源。
- [x] 合并 Release PR 后，GitHub App 创建产品版本 tag 和 Release，tag 对应准确 commit；自动 PR/tag 能触发独立 workflow。
- [x] 提供 App 权限、安装和凭据配置步骤，工具/Actions 固定版本或 commit，不读取或提交真实身份材料。
- [x] 说明 GitHub Release 创建与 npm 发布成功的区别，并记录真实 App/CI 行为的已验证或未验证状态。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 26、37–44、56–58。06 提供版本准备必须等待的当前 commit CI 门槛。

## Comments

- 2026-10-07：拆分已确认。本工单提供 tag，但不正式发布 npm。

- 2026-10-09：完成。精确锁定 Release Please17.3.0，root Manifest+JSON updater 实际更新唯一产品版本、CHANGELOG 和自动化记录；初始记录0.0.0仅为未发布 sentinel。版本准备独立 workflow 由成功 main push CI completion 驱动；重新检查准确 SHA 的最新 run/attempt；官方规划读取冻结历史、文件，Git data commit parent 固定到已通过 CI SHA。准确 merge SHA 的自身 CI 和产品版本校验后才创建 tag/Release，既有 tag 冲突停止，匹配 annotated tag/Release 可恢复标签。
- 2026-10-09：实际本地1382个 Git commit 的官方首次规划得到0.1.0，PR body87619字符超过平台 PR 限制。官方 FilePullRequestOverflowHandler 保存完整 metadata 到同一版本 commit 的 release-notes.md 并返回 immutable SHA 链接；合并解析从该 PR 的准确 merge commit 读取最后文案，保留维护者编辑。完整 CHANGELOG 不截断。Release body125000字符边界失败时保留待处理状态和完整文件，不擅自缩减文案。
- 2026-10-09：TDD 起点新 CI 门槛测试因缺失实现失败；最终 `rtk proxy bun test scripts/release/tests/prepare.test.ts` 31pass/90assertions/194ms，覆盖真实官方首版、feat/fix/perf、隐藏提交与 hidden BREAKING、beta.N、稳定、显式1.0.0；fake API 验证 moving-main、stale/failure、最新失败覆盖旧成功、准确合并 CI、实际官方 createRelease 请求、tag 冲突/annotated恢复、身份/HTTP adapter、漂移拒绝、完整 overflow 文案往返。
- 2026-10-09：`bun install --frozen-lockfile`、scripts typecheck、focused oxlint、Knip、actionlint1.7.12、文档与格式检查通过。单独隔离 workspace 将产品版本改0.1.1后仍通过 Bun frozen install，验证版本 PR 不需要另一套手工锁文件版本同步。未运行 full aggregate，交给整体规格最终验收。未进行真实 GitHub/App/CI/tag/Release 或 npm 写入；外部安装与权限步骤、版本切换归属 docs/release-preparation.md；工具版本归属 docs/tech-stack.md。
- 2026-10-09：ADR coverage review：ADR-0023 增补不可变 SHA 门槛与版本 PR parent/tag 决定及操作链接；其他运行架构未改变。
