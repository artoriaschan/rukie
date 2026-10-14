# 02：Project 名称、编辑与移除的 wire 命令

Status: resolved

**What to build:** 按 [spec](../spec.md#project-数据与-wire-命令)，让 `project.create` 接收名称，并新增 `project.update` 与 `project.remove`。服务端负责校验、信任提升与打开状态派生，前端随后可端到端使用。

- [x] `project.create` 新增必填 `name`（去除首尾空白后 1–128 字符）；复用已有主目录时返回原 Project，名称不变
- [x] `project.update { projectId, name, directories, primary, trusted? }`：复用创建校验（绝对路径、存在、真实路径去重、`project_reserved`、`project_conflict` 排除自身），要求目录非空、主目录属于目录列表
- [x] 已信任项目新增目录时，必须带 `trusted: true`，否则返回 `project_trust_required`；未信任项目新增目录后保持未信任；只改名、只移除目录或只切换主目录无需 `trusted`
- [x] `project.remove { projectId }`：只删除登记，Session、Transcript、置顶、归档与文件不变；项目任一目录下有执行中或等待交互的 Session 时返回 `session_busy`
- [x] 新命令进入现有 Project 变更队列，成功后发出变更事件
- [x] 编辑或移除后，已打开且空闲的 Session 在下一次空闲执行时按新的归属、附加目录与 `trustedProjects` 重开；活跃 Run 不中断
- [x] shared wire schema 与 UI store 解析同步；UI 的 `project.create` 调用补上名称（03 接入真实输入前，暂用主目录 basename）
- [x] 测试：server wire 按 spec 覆盖；store Node 测试覆盖解析变化
- [x] 更新 ADR-0041、CONTEXT.md Project 词条，以及 server/ui README 的 Project 命令

## Comments

2026-10-14：实现名称必填、完整编辑与移除 wire 命令，复用真实路径校验和 Project 变更队列；已信任新增目录必须显式确认，未信任编辑保留未信任。移除拒绝执行或等待 Interaction，保留 SQLite Session、Transcript、文件、置顶及归档。已打开 Session 按目录、归属与派生信任变化在下一次空闲执行重开，活跃 Run 保持执行。shared schema、client 错误解析、两种语言文案、全部创建消费者和 scripted wire fixture 已同步；App 暂以主目录 basename 提交名称，03 接入用户输入。

验证：Project 相关 server wire 范围第一次为 12 pass / 1 fail（2.69s），唯一失败是旧冲突 fixture 的 basename 名称预期；保留预期并提供明确 first/second 请求名称后，最小复验 1 pass（712ms）。后续打开配置快照修正只重验信任与重开两个用例，2 pass（1473ms）；UI Node client/store 两文件 19 pass（544ms）。每个新增行为都有先失败后通过证据；新集成用例使用真实 WS、SQLite、Hook 与受控模型 barrier，单例耗时均低于 1s。scoped oxlint、server/UI tsc 引用构建、docs:update、check:docs（150 Markdown）及 diff 检查通过。命令、环境修正、保留失败与证据复用范围记录于 `/tmp/rukie-shell-palette-evidence/ticket02.md`。ADR-0041、Project 词条与 server/UI README 已同步；本票沿用并扩展 spec ADR Coverage 中的精确信任与 Session 恢复边界。

本票仅关闭 wire 与 Node 解析要求；整个 spec 的集成评审、check:dev、桌面包与 Light/Dark/窄宽浏览器验收由 06 和主流程完成，CI 尚未执行，不代表整个 spec 已验收或合并。

- 2026-10-14：复审发现未满足的焦点、作用域对比度、目录别名归属与 fixture 清理要求，重新打开本票。新的单一修复代理在 `fix/project-management-review` 完成相关增量修复；证据见 `/tmp/rukie-shell-palette-evidence/review-fixes.md`。06 与整个 spec 仍等待最终验收。

- 2026-10-14：复审修复完成并经当前 focused 验证：40 个 Project/layout 浏览器用例、14 个实际归属消费者、14 个 store 用例、10 个真实 WS/SQLite Project 用例及真实 fixture 初始化失败/清理失败路径通过适用断言；类型、scoped lint、150 文档与格式通过。旧 `project.setPrimary` 已清理；服务端统一投影真实目录身份到 nullable `projectId`，旧别名 cwd 与 Transcript 保留，异步发布按一致登记状态重新派生。C27 删除后焦点、C31 Light 对比度、徽标 4px 位移和立即/幂等 fixture 清理已修复。End 的公开测量窗口重现精确 507px 后改为读取实时内容范围；新回归与原布局终点断言通过。详细命令、真实红、无效 fixture/诊断失败和增量复用边界见 `/tmp/rukie-shell-palette-evidence/review-fixes.md`。本票恢复 resolved 表示实现及复审 scoped 要求完成；spec 和 06 尚未关闭，整包、GUI、CI 与 PR 仍由最终验收负责。
