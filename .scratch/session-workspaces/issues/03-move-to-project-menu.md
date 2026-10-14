# 03：“移到项目”换项目、移出与选择文件夹

Status: ready-for-agent

Blocked by: 02

**What to build:** 按 [spec](../spec.md#移到项目工单-03)，扩展 `session.move` 与会话菜单。

- [ ] `session.move` 的 `projectId` 改为 `string | null`；`null` 创建新的 `workspace/<id>/` 作为目标 cwd 并删除绑定；已在“对话”时拒绝
- [ ] `sessionActions` 子菜单：其他 Project、“移出项目”（仅项目会话）、分隔线、“选择文件夹…”；右键、行内更多、标题栏一致
- [ ] “选择文件夹…”：选择单个目录，经信任确认后 `project.create`；主目录相同返回已有 Project 后移入，`project_conflict` 显示冲突，取消不创建不移动；移动失败保留已建 Project
- [ ] zh 与 en 文案同步
- [ ] 测试：server wire 覆盖移出、重复移出拒绝、移出后删除清理新目录；UI browser 覆盖三入口新菜单项、选择文件夹的已有/冲突/新建/取消路径
- [ ] 文档：server README、ui README 的 `session.move` 合同

## Comments
