# 01：新聊天选择条、项目菜单与分支菜单

Status: claimed

**What to build:** 按 [spec](../spec.md) 与 rukie.pen M03-A 实现 C32/C33/C34，并恢复 C36 实心删除按钮。

- [x] server：`WireProjectGit.branches`；`project.checkout`、`project.createBranch` 的校验、准入、串行与失败码
- [x] UI：C32 选择条（同宽、背景延伸、x 取消、创建后隐藏）
- [x] UI：C33 项目菜单（搜索、勾选、添加新项目、不使用项目、空状态）
- [x] UI：C34 分支菜单（全部本地分支、搜索、切换、创建并检出新分支、工作树勾选与说明、回显）
- [x] C36 删除按钮实心 destructive
- [x] zh/en；DESIGN.md、ADR-0045、server/ui README
- [ ] 测试：server wire 与 UI Chromium 已通过；agent-browser 验收未完成（见 Comments）

## Comments

- 2026-10-15 实现：`project.git` 并发执行 Git 查询并列出主目录可切换的本地分支（排除其他工作树已检出的分支）。`git switch` 在 post-checkout hook 失败时仍会先完成切换，server 以实际检出分支判定成功。本机全局 `core.hooksPath` 调用未安装的 lefthook，测试 fixture 的 Git 以 `core.hooksPath=/dev/null` 运行。Radix 菜单打开时其余页面为 aria-hidden，分支失败改在菜单内显示。C33 按设计去掉“编辑项目”，相关测试改从侧栏项目详情卡进入编辑器；客户端错误码白名单补充 `branch_invalid`/`git_failed`。
- 验证对象：`feat/new-chat-selector` 工作区（基线 `699da0ed`），包含本工单改动与同一工作区中另一任务的会话菜单、项目菜单、按压反馈等改动，共 78 个文件。
- 静态检查（仓库根）：`bunx --no -- tsc -b`、`oxlint`（866 文件）、`oxfmt --check`（1437 文件，修正本工单 3 个文件格式后通过）、`knip`、`check:docs`（155 文件）、`check:scratch`、`check:test-policy`（453 文件）、`check:ink-boundaries`、`check:ui-typography` 均 exit 0；`git diff --check` 通过。
- Bun：`env -u NO_COLOR bun test packages/server packages/shared` 104 pass / 0 fail，28.2s。新分支命令用例 3.0s：真实临时 Git 仓库与 WS，覆盖列表、切换、新建、非法名、未提交冲突保留文件、执行中 Session 拒绝；优化前 7.0s，Git 查询并发化后降至 3.0s，剩余为 Session 创建与 Git 进程启动的集成成本。
- UI：`packages/ui` 下 `vitest run --project ui-node` 9 files / 45 pass；`--project ui-browser` 首轮 4 失败（项目编辑入口仍指向已移除的 C33“编辑项目”、窄宽度侧栏默认收起、断言主区标题），修正测试后两文件 28/28，全量 32 files / 215 pass，32.9s。新选择条用例 3 pass（en 1280 / zh 420 dark 各约 1.4s）。
- Desktop：`env -u NO_COLOR bun run test:desktop` 49 files / 287 pass。wire 类型改动在 server/ui 之外无引用，未运行 agent/coding-agent 测试。
- 复验：首轮验证后另一任务又修改了 `button/base.tsx`、`popover.tsx`、`project-row.tsx` 与三个 UI 测试（工作区变为 81 个文件），这些改动使静态与 UI 结果失效。复验 `tsc -b`、`oxlint`、`oxfmt --check`、`knip`、`check:test-policy` 均 exit 0，`ui-browser` 全量 32 files / 215 pass，33.6s；server/shared 与 desktop 结果不受这些文件影响，继续沿用。
- 未完成：agent-browser 验收。`dev:desktop:web --isolated` 固定 `--port 5173 --strictPort`，端口被非本任务的两个 Vite 进程占用（10-13 遗留 PID 26114、10-15 11:02 另一任务 PID 71481），未结束他人进程。端口释放后需验收 Light/Dark/窄宽度、选择条几何、两个菜单的键盘与指针行为、控制台与网络。
