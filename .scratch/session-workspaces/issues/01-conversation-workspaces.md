# 01：对话独立工作目录

Status: resolved

**What to build:** 按 [spec](../spec.md#对话目录工单-01) 与 [ADR-0042](../../../docs/adr/0042-conversation-owned-workspace.md)，让每个新对话拥有并在删除时清理 `<dataRoot>/workspace/<id>/`。

- [x] `session.create { project: null }` 创建 `workspace/<id>/` 并作为 cwd；Agent Core 打开失败时删除该空目录
- [x] `session.delete` 在 Core 删除成功后删除 cwd 为 `workspace/` 直接子目录的目录；越界、符号链接与 `workspace/` 根不删除；目录删除失败只 warning
- [x] 删除确认框对 `projectId === null` 的会话增加目录删除说明，zh 与 en 同步
- [x] 测试：server wire 覆盖两个对话 cwd 不同且在 `workspace/` 下、open 失败不残留、删除清理目录、项目会话删除不碰项目目录、`workspace/` 根 cwd 不删除、符号链接拒绝；更新断言固定 `workspace` 根 cwd 的既有用例；UI browser 覆盖两种删除文案
- [x] 文档：CONTEXT.md Project 词条、server README、desktop README 中“共用 `workspace/`”的描述

## Comments

## Implementation evidence

- 实施分支：`feat/session-workspaces-01`，基于集成分支 `feat/session-workspaces`。每个新对话生成 `workspace/<UUID>/`；Core 打开失败只清理新建空目录。Core 删除成功后仅清理无链接的 workspace 直接子目录；根、项目、越界与链接路径保留，清理失败 warning 不回滚。
- 已更新删除确认框 zh/en、Project 词条、server 与 desktop README。复用现有 beUI 模态框与按钮，只改文案，未改 DOM 层级/CSS/尺寸，layout preservation gate 的几何变更前提不适用；最终 GUI 验收由集成负责人统一执行。
- TDD：独立目录用例先因相同 cwd 失败（427ms），创建实现后因文件未删除失败（323ms），安全删除后通过（300ms）。双语 UI 用例先因缺少工作目录说明失败，随后两例通过（1.63s）。
- `env -u NO_COLOR bun test packages/server/tests/server.test.ts`：64 pass / 0 fail，502 assertions，3.96s；包含已有 cwd 消费者、创建/删除、打开失败和安全边界。新增清理失败 warning 用例增量验证：1 pass / 0 fail，4 assertions，292ms。新测试单例均低于 1s；UI 两例合计 tests 1.21s，真实 Chromium 与 WS 启动/渲染成本。
- UI focused：在 `packages/ui` 运行 `env -u NO_COLOR node ../../node_modules/vitest/vitest.mjs run --project ui-browser tests/app/session-delete.browser.test.tsx`：2 pass / 0 fail，1.63s。初次从根目录筛选 `ui-browser` 未找到嵌套项目，已纠正 cwd；一次编辑命令 cwd 错误未改源码，关联运行已停止，保留诊断日志。
- 详细证据与日志：`/tmp/rukie-session-workspaces-evidence/01-verification.md`。工单保持 claimed，待集成 review、统一静态/desktop 与 GUI 验收后关闭。

- Review 修正：`fix/session-workspaces-review` 补齐 Project 移动/删除串行边界、工作树删除期间实际 Core 写者租约与重启前自动修复，以及 canonical workspace 祖先 inode/dev 校验。公开 server/Core reproducer 先红后绿；详细命令、原始失败、增量验证与责任边界见 `/tmp/rukie-session-workspaces-evidence/review-fixes-verification.md`。保留 claimed，最终验收与关闭由集成负责人执行。

## Final delivery evidence

- 2026-10-15：六个工单的实现、受影响文档、评审修复与适用本地验证完成；本工单与 spec 在同一变更设为 resolved。集成分支 `feat/session-workspaces`，PR #25 待最终推送、CI 与用户 review；resolved 不表示 CI 已通过或 PR 已合并。
- Standards / Spec review 的三个 P1 已由新修复代理处理，公开 Core / server reproducer 先红后绿；新 targeted reviewer 确认全部修正且没有剩余 actionable finding。详细记录：`/tmp/rukie-session-workspaces-evidence/review-corrections.md`、`review-fixes-verification.md`。
- 复用本工单现有 focused 证据与跨模块增量记录：Bun 514 pass / 0 fail + Agent e2e 1470 / 0；coding-agent 原全量 1528 / 16，全部 16 个旧权限 fixture 失败经六文件 212 / 1 与最后修正例 1 / 0 获得通过证据。Release 113 / 0；Desktop Node 70 通过，Chromium 原包 200 / 5，修正五例 5 / 0。工作树弹窗颜色修正 2 / 0，取消按钮尺寸修正 2 / 0。未声称全量重新通过。
- 最终 isolated Chromium GUI：实际对话创建/移动/删除、工作树创建/列表/刷新/取消/删除及 Session 回主目录、三入口菜单、Project 移除确认、Light/Dark/窄宽度、键盘/cursor/disabled、console/network 与清理通过。弹窗最终复验基于 `20b6e9aa`：Cancel 32px、Delete 36px，软危险色及 hover 正确，宽 448px / 窄 388px 无溢出，取消初始焦点与 Enter 取消保留工作树。详见 `gui-verification.md`、`gui-dialog-final.md`；未做真实 Electron、系统钥匙串或文件夹选择器视觉验收。
- ADR Coverage 审阅完成：决定、链接、accepted 状态与最终实现一致；工作树 host 根扩展由 ADR-0045 定义、ADR-0037 已链接承接。查看 [spec ADR Coverage](../spec.md#adr-coverage)。最终合同审阅与文档/tracker 命令记录：`/tmp/rukie-session-workspaces-evidence/delivery-verification.md`。
