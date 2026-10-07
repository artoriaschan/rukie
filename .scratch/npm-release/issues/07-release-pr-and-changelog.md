# 07：自动版本、Changelog 与 Release PR

Status: ready-for-agent
Blocked by: 06

## What to build

main 的必要检查成功后，维护者获得自动更新的 Release PR，集中审阅产品版本和完整 Changelog；合并该 PR 后由 GitHub App 创建准确版本 tag 和 GitHub Release，触发独立发布流程。

## Acceptance criteria

- [ ] main push 驱动 Release Please，以该 commit 的必要 CI 成功为前提；无关旧成功状态或失败状态不能放行。
- [ ] 从整个产品的 Conventional Commits 收集变更，包括内部包、锁文件和构建；不只扫描 coding-agent 目录。
- [ ] 自动维护 Release PR 的产品版本、Changelog 和跟踪状态，维护者可以审阅并调整发布文案；普通功能合并不直接发布 npm。
- [ ] 明确实现首版 0.1.0、0.x 兼容变更升 patch、不兼容变更升 minor，以及 beta.N/稳定切换；说明显式进入 1.0.0 的操作。
- [ ] Changelog 展示 feat/fix/perf 和不兼容变更，docs/test/chore 默认隐藏且不单独触发版本发布。
- [ ] 配置结果通过代表性提交与版本场景验证，产品 manifest 和自动化跟踪状态不会形成互相漂移的手工版本来源。
- [ ] 合并 Release PR 后，GitHub App 创建产品版本 tag 和 Release，tag 对应准确 commit；自动 PR/tag 能触发独立 workflow。
- [ ] 提供 App 权限、安装和凭据配置步骤，工具/Actions 固定版本或 commit，不读取或提交真实身份材料。
- [ ] 说明 GitHub Release 创建与 npm 发布成功的区别，并记录真实 App/CI 行为的已验证或未验证状态。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 26、37–44、56–58。06 提供版本准备必须等待的当前 commit CI 门槛。

## Comments

- 2026-10-07：拆分已确认。本工单提供 tag，但不正式发布 npm。
