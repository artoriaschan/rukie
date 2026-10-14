# 01：对话独立工作目录

Status: claimed

**What to build:** 按 [spec](../spec.md#对话目录工单-01) 与 [ADR-0042](../../../docs/adr/0042-conversation-owned-workspace.md)，让每个新对话拥有并在删除时清理 `<dataRoot>/workspace/<id>/`。

- [ ] `session.create { project: null }` 创建 `workspace/<id>/` 并作为 cwd；Agent Core 打开失败时删除该空目录
- [ ] `session.delete` 在 Core 删除成功后删除 cwd 为 `workspace/` 直接子目录的目录；越界、符号链接与 `workspace/` 根不删除；目录删除失败只 warning
- [ ] 删除确认框对 `projectId === null` 的会话增加目录删除说明，zh 与 en 同步
- [ ] 测试：server wire 覆盖两个对话 cwd 不同且在 `workspace/` 下、open 失败不残留、删除清理目录、项目会话删除不碰项目目录、`workspace/` 根 cwd 不删除、符号链接拒绝；更新断言固定 `workspace` 根 cwd 的既有用例；UI browser 覆盖两种删除文案
- [ ] 文档：CONTEXT.md Project 词条、server README、desktop README 中“共用 `workspace/`”的描述

## Comments

## Implementation evidence

- 实施分支：`feat/session-workspaces-01`，基于集成分支 `feat/session-workspaces`。每个新对话生成 `workspace/<UUID>/`；Core 打开失败只清理新建空目录。Core 删除成功后仅清理无链接的 workspace 直接子目录；根、项目、越界与链接路径保留，清理失败 warning 不回滚。
- 已更新删除确认框 zh/en、Project 词条、server 与 desktop README。复用现有 beUI 模态框与按钮，只改文案，未改 DOM 层级/CSS/尺寸，layout preservation gate 的几何变更前提不适用；最终 GUI 验收由集成负责人统一执行。
- TDD：独立目录用例先因相同 cwd 失败（427ms），创建实现后因文件未删除失败（323ms），安全删除后通过（300ms）。双语 UI 用例先因缺少工作目录说明失败，随后两例通过（1.63s）。
- `env -u NO_COLOR bun test packages/server/tests/server.test.ts`：64 pass / 0 fail，502 assertions，3.96s；包含已有 cwd 消费者、创建/删除、打开失败和安全边界。新增清理失败 warning 用例增量验证：1 pass / 0 fail，4 assertions，292ms。新测试单例均低于 1s；UI 两例合计 tests 1.21s，真实 Chromium 与 WS 启动/渲染成本。
- UI focused：在 `packages/ui` 运行 `env -u NO_COLOR node ../../node_modules/vitest/vitest.mjs run --project ui-browser tests/app/session-delete.browser.test.tsx`：2 pass / 0 fail，1.63s。初次从根目录筛选 `ui-browser` 未找到嵌套项目，已纠正 cwd；一次编辑命令 cwd 错误未改源码，关联运行已停止，保留诊断日志。
- 详细证据与日志：`/tmp/rukie-session-workspaces-evidence/01-verification.md`。工单保持 claimed，待集成 review、统一静态/desktop 与 GUI 验收后关闭。

- Review 修正：`fix/session-workspaces-review` 补齐 Project 移动/删除串行边界、工作树删除期间实际 Core 写者租约与重启前自动修复，以及 canonical workspace 祖先 inode/dev 校验。公开 server/Core reproducer 先红后绿；详细命令、原始失败、增量验证与责任边界见 `/tmp/rukie-session-workspaces-evidence/review-fixes-verification.md`。保留 claimed，最终验收与关闭由集成负责人执行。
