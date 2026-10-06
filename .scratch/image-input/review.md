# 图片输入集成审查

审查基点：`4b58bb1ca53134b578bde12e55eb598828e56111`；八票集成提交：`ac1341fa15d794a5435a0b38fdbb08ddcf1f299c`。Standards 与 Spec 由独立只读代理审查；以下保留各轴结论，修复与最终验收另列。

## Standards

Reviewed `4b58bb1...ac1341fa15d794a5435a0b38fdbb08ddcf1f299c`; read-only. No applicable subtree AGENTS beyond root and `docs/AGENTS.md`. Tooling-enforced issues excluded.

### Documented violations

- **[P1] Bound warning rows before reserving the dock** — `apps/neant-tui/src/screens/chat/index.tsx:861–872` wraps the complete configured model spec and adds every resulting row to `promptHeight` without an upper bound. The public 40×12 reproduction with a valid 300-character custom model id returns `editorVisible:false, statusVisible:false`. This violates root `AGENTS.md` “Preserve … small-terminal handling” and ADR-0006’s fixed bottom input/status and input-height budget. Bound the displayed model label/notice rows while preserving the warning meaning; cover long ids, resize and submission.

- **[P2] Keep user-visible error codes in the shared contract** — `packages/agent/src/images/index.ts:14–26` introduces the frontend-facing `ImageValidationCode` union only inside Agent Core; `apps/neant-tui/src/i18n/index.ts:15–27` creates a separate class-specific translation path. ADR-0008 explicitly places the error-code union in `@neant/shared`, with code plus typed parameters as the frontend boundary. Public zh `start` confirms oversized read loses metadata (`details:{}`) and renders an English error card. Minimal fix: add shared typed codes/parameters and wrap both adapted read tools with existing `preserveErrorDetails`; translate frontend/replay metadata while preserving the English model-visible text. Keep byte inspection in Agent Core.

### Judgment calls

- **Possible Duplicated Code** — Chat’s clipboard stage (`index.tsx:584–598`) and path-paste success (`index.tsx:1619–1627`) both perform “read → owner check → bind → insert → notifyPastedImage.” Share that admission/staging step with caller-specific fallback policy so future binding/ownership fixes cannot drift.

- **Possible Duplicated Code** — `host/clipboard.ts:39–86,200–209` and `host/image-viewer.ts:10–47` separately implement private export-directory creation, pending-operation tracking, closed guards and disposal. A small shared private-export owner could centralize resource obligations if it remains simpler than these two implementations.

Documentation follow-up: `docs/architecture.md` lacks the new `images/` responsibility and per-main host/export lifetime; source JSDoc owns the detailed contract. Add concise ownership descriptions and source links, without duplicating APIs. No new ADR is necessary for the existing ownership boundaries.

Two documented violations; two judgment calls. No integration mutations performed. The earlier read validation bypass is fixed and is not an open finding.

## Spec

Base: `4b58bb1ca53134b578bde12e55eb598828e56111`; reviewed HEAD: `ac1341fa15d794a5435a0b38fdbb08ddcf1f299c`. Sources: `.scratch/image-input/spec.md`, all eight tickets, complete change list, source/test diff, and root public reproductions.

1. **[P2] Long model warnings hide the editor at the specified minimum size.** Spec user story 31 says “paste and token behaviour to work in small terminals and after resize”; Testing Decisions requires “小终端（40×12）与 resize 后 token 不被换行拆开。” At `apps/neant-tui/src/screens/chat/index.tsx:244`, the notice interpolates the entire model spec. Lines 861–872 wrap it into an unbounded number of rows and include all those rows in `promptHeight`; `PromptInput` renders the full warning above the editor. `packages/shared/src/settings.ts:106` permits the valid 307-character custom model ID used by `/tmp/neant-image-input-long-warning-repro.ts`. Re-running that public `start` reproduction on the pinned HEAD yielded `editorVisible:false` and `statusVisible:false` at 40×12. Bound the displayed model label or notice row budget while retaining warning meaning, editor/status, short-name copy and independent timers. This is the already-tracked root finding; the fixer owns it.

No additional confirmed missing/partial/wrong requirements or scope creep found. Session run/steer validation, ordered content and metadata stripping, persisted resume/compaction, text-only hooks/title/history, custom input schema and provider downgrade, Context Usage/report estimates, read/subagent checks, host injection, path/clipboard admission, token occurrence identity/reset, placeholders/viewer lifetime and both locale dictionaries have corresponding implementation paths and public regressions. Ticket 01 documents the agreed existing hook protocol; conditional `updatedPrompt` wording does not require adding a new hook protocol. Existing question Alt+V is preserved, not newly introduced for the composer. TIFF export supplies the required unsupported notice; it does not add TIFF decoding/support.

The previously fixed read-guard bypass is closed: re-running `/tmp/neant-image-input-read-repro.ts` yielded `isError:true`, text-only content. `detectReadImageMimeType` now recognizes native-supported signatures independently of dimensions before shared byte validation, while preserving pi APNG/JPEG-LS/BMP behavior. Clipboard manual evidence in ticket 07 covers actual Finder copy, native screenshot production, private modes, per-main cleanup and complete restoration. Linux/Windows manual execution remains honestly unclaimed, as permitted by the macOS-only manual test decision.

Spec total: one confirmed finding, already assigned to the fixer; no new findings beyond it. These two public reproductions were run during this review; the full suite is root-owned aggregate verification.

## 修复闭环

最终修复提交：`cc91efcdf6e432f206cebb36aea28cdc70f4a85b`。同一 implementer 处理全部发现；另一代理复核 `ac1341fa...cc91efc` 后确认没有待修问题。

| 轴        | 发现                                    | 修复与公开验证                                                                                                                                                                                      |
| --------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standards | 长模型名提示挤占底部输入区              | 按终端列宽截断显示名称；40×12、80→40 resize 与携图发送回归保留编辑器、状态行和独立提示计时器。                                                                                                      |
| Standards | 图片错误绕过共享契约，read 丢失错误详情 | 图片错误码与类型化参数归 `@neant/shared`；通用 zh/en 错误字典及 formatter 翻译，read 经已有 `preserveErrorDetails` 保留详情；公开 read 与 resume 测试验证卡片翻译、错误参数及原始英文模型工具结果。 |
| Standards | 重复图片暂存步骤                        | 路径与剪贴板共用最小 `stageImage`，各自保留原文插入或 notice 的失败策略及异步 owner 检查。                                                                                                          |
| Standards | 重复临时导出生命周期                    | 剪贴板与查看器各持自己的 `createPrivateExports` 实例；公开退出与 pending open 测试检查原始字节、0700/0600 权限、终端恢复及等待外部使用完成后的删除。                                                |
| Spec      | 长模型名在40×12遮挡编辑器               | 与 Standards 的同一布局修复；不限制合法 settings 模型 ID 长度。                                                                                                                                     |

[架构参考](../../docs/architecture.md)同步图片领域、Session/Transcript 图片路径、TUI host 与资源归属、自定义模型能力。相关 02/05/07/08 工单补充修复证据。修复 focused 检查为 142 pass / 0 fail / 700 assertions，pending-open 最终单例另行通过；静态检查通过。

Standards：2 项规范违约、2 项判断项，最高为 P1，全部关闭。Spec：1 项，最高为 P2，已关闭；没有额外需求缺口或范围扩张。

## 集成验证

修复合并提交：`2977ae3144bb642444e877cd326f9002d0663538`，分支 `codex/image-input`。合并后的 focused 检查 80 pass / 0 fail / 222 assertions；`tsc -b` 与 `git diff --check` 通过。根线程再次运行公开场景，超限且头部元数据损坏的 JPEG 返回 `isError: true`、只含文本；长模型名场景保留编辑器及倒数第二行的 Ask 状态栏。临时测量脚本原先误用末行 Esc hint 检测 idle 状态，最终按真实 Ask 状态行修正；仓库回归测试直接断言该状态行。

合并八票后、审查修复前，全量 `env -u NO_COLOR bun run check` 已通过（2091 pass / 0 fail / 10307 assertions / 151 files）。最终修复后的全量检查通过：2095 pass / 0 fail / 10324 assertions / 152 files，244.39 s。

最终命令：`rtk proxy caffeinate -is env -u NO_COLOR bun run check`，在 `2977ae3144bb642444e877cd326f9002d0663538` 执行，exit 0。格式、lint、项目引用类型检查、Knip、全部 Bun 测试通过。没有新增外部依赖，Bun lockfile 未变化。macOS Finder 文件复制、原生窗口截图的 PNG 优先、纯文本/空剪贴板/不支持的 TIFF 分支、0700/0600 与每实例清理手动验证见 [07 工单](issues/07-ctrl-v-clipboard.md)；原始剪贴板全部格式已逐字节恢复。

临时复现脚本已清理；可重复的回归留在 [模型提示测试](../../apps/neant-tui/tests/e2e/image-model-notice.test.ts)、[错误与恢复测试](../../apps/neant-tui/tests/e2e/image-errors.test.ts)、[图片流程与生命周期测试](../../apps/neant-tui/tests/e2e/images.test.ts) 和 [read/Usage 测试](../../packages/agent/tests/e2e/image-read-and-usage.test.ts)。

## 收尾

九个 implementer 工作树（01–08 与 review-fixes）已确认干净、HEAD 属于最终集成历史后通过 managed archive 归档；artifact 列表显示九个 `archived_worktree`，本地目录与 Git worktree 注册均已移除。该阶段保留集成工作树用于后续 main 合并。

## main 集成与清理

2026-10-06：按用户“合并到 main，删除 worktree”的要求，将 `9d3808990f8520a94f85de1047a97d9b64892229` 合入已包含文件变更检测的 main；合并提交为 `9e7c599b87d2b32cc35df3af713912eb0f9aec91`，另一父提交为 `6bf269d424be64427c0840f0abfc303190dfe8da`。

两处冲突已保留双方意图：架构文档同时保留文件跟踪的存储/恢复说明与 inline 图片说明；read 使用 `track(preserveErrorDetails(adaptTool(...ImageReadEnv...)))`，write/edit 继续由原文件跟踪包装，readonly read 保留图片检查与错误详情。Session 自动合并，图片 TUI、shared、i18n、config 与 Usage 部分和原集成分支一致。

合并前重新执行全测试：2095 pass / 0 fail / 10324 assertions / 152 files（255.81 s）。合并后在 main checkout 执行 `rtk proxy caffeinate -is env -u NO_COLOR bun run check`，exit 0：**2153 pass / 0 fail / 11065 assertions / 153 files**（255.18 s）；格式、lint、类型与 Knip 全部通过。`bun install --frozen-lockfile` 未修改依赖；架构/spec/review 共核对 40 个相对路径，无缺失。

删除前确认 main 与集成工作树均无未提交或未跟踪文件，`main..codex/image-input` 为 0；十个图片输入分支的 HEAD 均为 main 祖先。Codex managed archive 拒绝移除当前聊天的 primary checkout，因此按用户明确授权，从 main checkout 使用不带 `--force` 的 `git worktree remove` 删除 700c 集成工作树，再用 `git branch -d` 删除已合并的十个图片输入分支。目录、Git worktree 注册及分支引用均已核对清理；原九个 implementer 归档保留。
