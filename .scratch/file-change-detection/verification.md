# 文件外部修改检测验收

2026-10-06：[spec](spec.md) 与实施票 01 → 02 → 03 → 04 → 05 按依赖顺序完成，集成分支为 `codex/file-change-detection`。起点为 `4b58bb1ca53134b578bde12e55eb598828e56111`，代码与测试验收提交为 `261a9b013fda071e1107c6b385ace7656633d47d`。五张票与 spec 均为 resolved。

## 交付范围

Agent Core 跟踪成功 read、write、edit 后的完整文件，在每次模型请求前通过现有 `file-changes` System Reminder 报告外部修改或删除。diff 单文件上限 4K、每次请求新增提醒总量上限 16K，超限与非文本、不可读文件提示重读，延期文件继续报告。write / edit 保护过期文件；跟踪状态通过 Tool State 持久化，支持 Session Resume、Compaction、Rewind 与独立 Subagent。架构与精确依赖文档已同步。

## 验证

| 检查                                                               | 结果                                                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `rtk proxy env -u NO_COLOR bun run check`                          | exit 0；格式、lint、types、Knip 通过；2026 pass / 0 fail，10713 assertions，145 files，222.87s |
| `rtk proxy bun test packages/agent/tests/e2e/file-changes.test.ts` | 58 pass / 0 fail，741 assertions；实现代理在最终测试提交上运行                                 |
| 重点 BOM、失败持久化、一次交付、Compaction 预算回归                | 17 pass / 0 fail，364 assertions                                                               |
| root 独立复跑三个审查诊断                                          | 3 pass / 0 fail：删除通知重试、BOM 实际 diff、Resume 提醒不重复                                |

完整检查在最终代码与测试提交上运行，随后仅补充 tracker 与验收文档；文档通过格式、相对链接和 diff 检查。

## 审查与清理

Standards 与 Spec 最终审查均为 0 条剩余发现。初审与续审问题全部由同一修复代理解决；提醒与最终基线在原生事务中原子提交，失败重试保持一次交付，BOM 增删保留实际 diff，Compaction 及失败提醒正确释放请求预算。红绿证据见 [审查记录](review.md)。并发读取顺序的测试假设已修正，覆盖跨批次全部文件且不重复。

五个实施工作区与一个审查修复工作区，归档前均为 clean 且 HEAD 已包含在集成分支；通过 Codex managed worktree 归档保存可恢复快照。附件列表确认六项均为 archived_worktree，Git 工作区列表确认六个 checkout 已移除。首次集成验收时，集成工作区保留，main 仍为起点提交。

## Main 合并验收

2026-10-06：按用户要求将 `codex/file-change-detection` 快进合并到 main，合并提交为 `a1eb6920384a07a3a93a1984b800b83f9e7b3596`。main 首次类型检查缺少新增的直接依赖 `diff`；运行 `rtk proxy bun install --frozen-lockfile` 同步工作区依赖后，`rtk proxy env -u NO_COLOR bun run check` 完整通过：exit 0，2026 pass / 0 fail，10713 assertions，145 files，230.03s。同步依赖没有修改锁文件或其他已跟踪文件。

当前集成 worktree 的提交全部在 main 中，且工作区干净。Codex 的 `archive_worktree` 拒绝移除该聊天的主工作区，返回 `The task's primary checkout cannot be removed.`；Computer Use 也禁止操作 Codex 应用。当前集成 worktree 与其分支因此保留，需先通过应用将聊天移出该 worktree，再执行清理。六个实施与修复 worktree 已在此前归档并移除。
