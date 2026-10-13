# 03：桌面端多目录 Project 与信任确认

Status: ready-for-agent

Blocked by: 01

**What to build:** 按 [spec](../spec.md#project-登记表)、[信任](../spec.md#信任) 与 [切换主目录](../spec.md#切换主目录)，把桌面端 Project 改为多目录并带显式信任状态，替换 `project.add`，从 UI 到 Agent Core 端到端可用。

- [ ] registry 与 `WireProject` 改为 `{ id, name, directories, primary, trusted }`；旧记录迁移为单目录、未信任；store 解析同步
- [ ] `project.create` 替代 `project.add`：校验目录存在且为真实路径、`trusted: true`、`<dataRoot>` 保留（`project_reserved`）、重叠（`project_conflict` + 冲突 Project 名）、主目录已存在时返回已有 Project；删除 `project.add` 及其消费方
- [ ] `project.trust` 与 `project.setPrimary`
- [ ] 打开 Session 时把已信任 Project 的全部目录并入 `trustedProjects`，并把所属 Project 的其余目录作为 `additionalDirectories` 传入
- [ ] 侧栏分组改为 cwd 等于 Project 任一目录；搜索浮层的 Project 名称与标题栏当前 Project 同步
- [ ] 创建流程：选择一个或多个目录，第一个为主目录；目录列表项 hover 或聚焦显示“设为主要”；信任确认框列出目录与影响，取消不发送命令；“打开文件夹”走同一流程；主目录已存在时直接在该 Project 新建会话
- [ ] 未信任 Project 在打开或新建 Session 前补确认；拒绝时照常运行
- [ ] 按 DESIGN.md 实现目录列表与确认框（先补充 DESIGN.md 规则），先过 layout preservation gate；zh 与 en 同步
- [ ] ADR 记录桌面端显式信任与精确匹配；更新 CONTEXT.md Project 词条、docs/hooks.md、docs/permission-rules.md
- [ ] 测试：服务端 wire、store Node、UI browser 按 spec 覆盖；布局回归用例
