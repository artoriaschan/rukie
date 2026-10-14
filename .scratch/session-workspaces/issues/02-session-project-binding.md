# 02：Session 绑定 Project 与移除级联删除

Status: ready-for-agent

Blocked by: 01

**What to build:** 按 [spec](../spec.md#project-绑定工单-02) 与 [ADR-0043](../../../docs/adr/0043-session-project-binding.md)，以持久绑定替代 cwd 现算的归属，主目录切换后懒同步，移除 Project 删除其 Session。

- [ ] 应用数据根 `app.sqlite` 新增 Session 绑定表；`session.create`、`session.move`、`session.delete` 维护绑定；摘要 `projectId` 读取绑定，移除基于目录身份的归属计算
- [ ] 附加目录与 `trustedProjects` 按绑定 Project 派生
- [ ] 打开执行前懒同步：cwd 不等于绑定 Project 主目录时先 Session Move；只读订阅不移动；活跃 Run 不中断
- [ ] `project.update` 不再检查或改变 Session 归属
- [ ] `project.remove` 检查全部绑定 Session 忙碌状态，逐个按 `session.delete` 删除（含置顶、归档与对话目录规则），全部成功后移除登记；中途失败保留 Project
- [ ] 移除确认框说明改为“确定删除该项目及其全部对话？项目目录中的文件不会被删除。”与对应 en 文案，删除按钮 destructive，取消保持初始焦点
- [ ] 测试：server wire 覆盖绑定写入与删除、主目录切换后 prompt 触发移动并告知模型、只读订阅不移动、删减目录不丢归属、移除级联删除（含归档、置顶）与忙碌拒绝、项目文件保留；UI browser 覆盖移除文案、按钮样式与焦点
- [ ] 文档：CONTEXT.md Project/Session 词条、server README

## Comments
