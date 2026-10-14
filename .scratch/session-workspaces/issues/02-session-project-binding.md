# 02：Session 绑定 Project 与移除级联删除

Status: claimed

Blocked by: 01

**What to build:** 按 [spec](../spec.md#project-绑定工单-02) 与 [ADR-0043](../../../docs/adr/0043-session-project-binding.md)，以持久绑定替代 cwd 现算的归属，主目录切换后懒同步，移除 Project 删除其 Session。

- [x] 应用数据根 `app.sqlite` 新增 Session 绑定表；`session.create`、`session.move`、`session.delete` 维护绑定；摘要 `projectId` 读取绑定，移除基于目录身份的归属计算
- [x] 附加目录与 `trustedProjects` 按绑定 Project 派生
- [x] 打开执行前懒同步：cwd 不等于绑定 Project 主目录时先 Session Move；只读订阅不移动；活跃 Run 不中断
- [x] `project.update` 不再检查或改变 Session 归属
- [x] `project.remove` 检查全部绑定 Session 忙碌状态，逐个按 `session.delete` 删除（含置顶、归档与对话目录规则），全部成功后移除登记；中途失败保留 Project
- [x] 移除确认框说明改为“确定删除该项目及其全部对话？项目目录中的文件不会被删除。”与对应 en 文案，删除按钮 destructive，取消保持初始焦点
- [x] 测试：server wire 覆盖绑定写入与删除、主目录切换后 prompt 触发移动并告知模型、只读订阅不移动、删减目录不丢归属、移除级联删除（含归档、置顶）与忙碌拒绝、项目文件保留；UI browser 覆盖移除文案、按钮样式与焦点
- [x] 文档：CONTEXT.md Project/Session 词条、server README

## Comments

- 实施：应用数据根 `session_bindings` 成为归属源，create/move/delete 维护绑定；空闲执行前同步主目录，只读订阅不移动，执行中的 Run 保留原配置。移除 Project 先检查并独占全部绑定 Session，经同一删除路径清除 Session/置顶/归档，失败保留 Project。创建与项目变更共用队列，防止创建/移除竞态。无既有 Session 绑定补写。
- 红/绿：wire tracer 在原实现因删减目录丢失 projectId 失败，实现后通过；server 文件 66 通过（4.96s），后续两例 model reminder/外部 writer 租约增量通过（518ms），三例准入与活跃 Run 配置同步增量通过（811ms）。原有目录身份归属与移除保留历史断言按 ADR-0043 改为绑定/级联删除。
- UI：两文件 28 例中 27 通过（26.17s）；选中 Session 移除用例修正从侧栏进入编辑后独立通过（1.52s），有效证据合计 28 例。覆盖 en 确认文案、destructive、取消初始焦点、busy 提示、Light/Dark/窄窗口几何；zh 文案同步。C31 已符合 Pencil，未修改设计稿。
- 检查：`bunx --no tsc -b --pretty false` 通过；更晚准入/测试改动交由最终静态复验。`oxfmt` 与 `git diff --check` 通过。日志与逐次证据：`/tmp/rukie-session-workspaces-evidence/02-verification.md`。最终静态、聚合/desktop、agent-browser 验收与分支 review 由 integration owner 协调；工单保持 claimed 至统一关闭。

- 合入最新 integration（工单 04）后：Session 范围内 write 自动放行使六个 server 权限卡生命周期 fixture 失效；保留原组合结果 60 pass / 6 fail（`02-post04-server.log`），统一改为 homeDir 下范围外的文件路径。六例增量全部通过（584ms）；Project 移除的等待场景同样改为范围外 write，项目内文件写入仍验证保留。UI 与目录几何证据继续复用，不重跑。
