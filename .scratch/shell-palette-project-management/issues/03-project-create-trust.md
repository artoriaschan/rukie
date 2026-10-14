# 03：创建项目、统一信任确认与目录行

Status: resolved

Blocked by: 02

**What to build:** 按 [spec](../spec.md#创建项目c27与统一信任确认c28) 与 [目录行](../spec.md#目录行c27-与-c29-共用)，把创建项目弹窗改为 pen 的 C27，把信任确认改为多目录的 C28，并实现 C27 与 C29 共用的目录行。

- [x] 先按 pen 的 C27–C31 重写 DESIGN.md 的 Project directories and trust 段落，加入 `path-tooltip` 与 `destructive-soft` 作用域 token，保留详情卡锚定规则；再改 UI
- [x] 开始改动前记录 layout preservation 基线（project-directories、layout 浏览器测试）
- [x] C27：480px，名称输入框自动聚焦；空状态入口；目录列表与“添加文件夹”行；首个目录自动填名；无名称或无目录时禁用；点击“创建项目”打开 C28
- [x] C28：416px，“信任这些文件夹吗？”；高度受限的 ScrollArea 目录列表（完整路径、主要徽标、编辑场景的“新增”标记）；pen 说明文案；纵向全宽操作，主操作依场景为“信任并创建 / 信任并保存 / 信任”；取消返回表单并保留输入；旧 Project 补确认与 Session Move 复用
- [x] 删除手动路径输入；`host.pickFolder` 返回 `unsupported` 时显示 alert，入口保持可用；同步 ui README
- [x] 目录行组件：basename 加重名时的父目录区分；主要徽标；hover 或 focus-within 显示 ghost“设为主要”（空间预留）；移除按钮（最后一个目录禁用，移除主目录时由下一个接任）；行上方 4px 的完整路径提示，使用 `path-tooltip` token
- [x] 项目弹窗统一外观（圆角、内距、标题行、关闭按钮、32/36px 控件），不改动 MorphingModal 全局默认值
- [x] zh 与 en 文案同步，删除不再使用的键
- [x] 扩展 fake wire helper（`name`）；更新 project-directories 与 session-move 浏览器测试中受影响的断言，按 spec 补充创建、信任、选择器回退与目录行用例；layout 回归通过

## Comments

- 2026-10-14：独立分支 `feat/project-create-trust` 基于集成 `df72c38b`，先经 Pencil MCP 核对 C27–C31 与作用域 token，再更新 DESIGN.md。C27 名称/空状态/追加目录、统一 C28、共享目录行、Web 选择失败重试及双语文案已实现；创建错误返回保留输入的表单。旧只读目录弹窗暂时复用共享行，由 04 删除并替换为编辑入口。
- TDD 与布局：原 project-directories 基线 6 项通过；创建名称/保留草稿、目录行整行 32px、已登记主目录捷径和模态路径提示 hit-test 均有 red/green 证据。受影响浏览器入口 14 项通过；新增 Light 宽屏与 Dark 窄屏几何/长列表/提交禁用 2 项通过；最终路径提示与 inset focus 增量 3 项通过；追加目录/名称保留与现有外壳 layout 7 项通过。结果逐项复用，未把中途失败称为通过。
- 复用已安装 beUI MorphingModal/Input/Button/Tooltip，目录徽标使用公开 MCP 的 beUI AnimatedBadge 完整组件源码并按 DESIGN.md 适配；领域表单/目录行组合已有原语，因为 registry 不拥有 Project 草稿语义。未改变 MorphingModal 全局几何。路径提示使用独立 modalHint 55 层，位于弹窗之上、菜单之下，普通 Tooltip 仍使用 hint 40。
- scoped UI typecheck 与 changed-file lint 通过，docs:update/check:docs 通过（150 个 Markdown）。详细命令、环境、耗时、失败与证据有效性见验证负责人提供的 `/tmp/rukie-shell-palette-evidence/ticket03.md`。完整静态、适用 desktop 包级和最终 agent-browser/screenshots 统一由 [06](06-acceptance.md) 完成，当前不声称 CI/GUI/合并已验收。

- 2026-10-14：复审发现未满足的焦点、作用域对比度、目录别名归属与 fixture 清理要求，重新打开本票。新的单一修复代理在 `fix/project-management-review` 完成相关增量修复；证据见 `/tmp/rukie-shell-palette-evidence/review-fixes.md`。06 与整个 spec 仍等待最终验收。

- 2026-10-14：复审修复完成并经当前 focused 验证：40 个 Project/layout 浏览器用例、14 个实际归属消费者、14 个 store 用例、10 个真实 WS/SQLite Project 用例及真实 fixture 初始化失败/清理失败路径通过适用断言；类型、scoped lint、150 文档与格式通过。旧 `project.setPrimary` 已清理；服务端统一投影真实目录身份到 nullable `projectId`，旧别名 cwd 与 Transcript 保留，异步发布按一致登记状态重新派生。C27 删除后焦点、C31 Light 对比度、徽标 4px 位移和立即/幂等 fixture 清理已修复。End 的公开测量窗口重现精确 507px 后改为读取实时内容范围；新回归与原布局终点断言通过。详细命令、真实红、无效 fixture/诊断失败和增量复用边界见 `/tmp/rukie-shell-palette-evidence/review-fixes.md`。本票恢复 resolved 表示实现及复审 scoped 要求完成；spec 和 06 尚未关闭，整包、GUI、CI 与 PR 仍由最终验收负责。
