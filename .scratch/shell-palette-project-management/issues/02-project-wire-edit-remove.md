# 02：Project 名称、编辑与移除的 wire 命令

Status: ready-for-agent

**What to build:** 按 [spec](../spec.md#project-数据与-wire-命令)，让 `project.create` 接收名称，并新增 `project.update` 与 `project.remove`。服务端负责校验、信任提升与打开状态派生，前端随后可端到端使用。

- [ ] `project.create` 新增必填 `name`（去除首尾空白后 1–128 字符）；复用已有主目录时返回原 Project，名称不变
- [ ] `project.update { projectId, name, directories, primary, trusted? }`：复用创建校验（绝对路径、存在、真实路径去重、`project_reserved`、`project_conflict` 排除自身），要求目录非空、主目录属于目录列表
- [ ] 已信任项目新增目录时，必须带 `trusted: true`，否则返回 `project_trust_required`；未信任项目新增目录后保持未信任；只改名、只移除目录或只切换主目录无需 `trusted`
- [ ] `project.remove { projectId }`：只删除登记，Session、Transcript、置顶、归档与文件不变；项目任一目录下有执行中或等待交互的 Session 时返回 `session_busy`
- [ ] 新命令进入现有 Project 变更队列，成功后发出变更事件
- [ ] 编辑或移除后，已打开且空闲的 Session 在下一次空闲执行时按新的归属、附加目录与 `trustedProjects` 重开；活跃 Run 不中断
- [ ] shared wire schema 与 UI store 解析同步；UI 的 `project.create` 调用补上名称（03 接入真实输入前，暂用主目录 basename）
- [ ] 测试：server wire 按 spec 覆盖；store Node 测试覆盖解析变化
- [ ] 更新 ADR-0041、CONTEXT.md Project 词条，以及 server/ui README 的 Project 命令

## Comments
