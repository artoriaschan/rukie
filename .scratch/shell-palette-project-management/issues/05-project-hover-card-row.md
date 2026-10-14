# 05：项目详情卡与项目行

Status: resolved

Blocked by: 04

**What to build:** 按 [spec](../spec.md#项目详情卡c30与项目行)，实现侧栏项目行的悬停与选中状态，以及悬停或聚焦时显示的项目详情卡 C30。

- [x] 开始改动前记录 sidebar 与 layout 的 layout preservation 基线
- [x] 项目行：32px、8px 圆角，`hover` 与 `selected` 背景（当前会话属于该项目时为 `selected`）；hover 或 focus-within 时只显示“新建会话”（空间预留）；不渲染“⋯”与右键菜单；侧栏宽度和会话行几何不变
- [x] C30：320px；名称与图钉、会话数（未归档，含置顶）、目录完整路径（`~` 缩写）、“编辑项目”行；由已安装的 beUI Popover 受控组合
- [x] 打开：停留约 300ms 或获得键盘焦点；关闭：离开约 150ms 后或按 Esc；以门户渲染，距悬停背景右边缘 4px、顶边对齐，可覆盖中间导航并按视口夹取；指针可穿过间隙进入卡片
- [x] 图钉临时固定，固定后再次点击图钉、按 Esc 或点击外部关闭，状态不持久化；“编辑项目”关闭卡片并打开 C29
- [x] 打开状态可由外部关闭，为将来“⋯”菜单与详情卡互斥预留
- [x] zh 与 en 文案同步
- [x] 浏览器测试：使用虚拟时钟验证延迟截止前与截止时的状态、键盘打开、穿越间隙、图钉、Esc 与外部点击、编辑入口、会话数、锚定矩形；项目行 hover 与选中背景

## Comments

- 2026-10-14：基于 `dcdd0ad6` 在独立 `feat/project-hover-card` 实现。项目行复用已安装 beUI Popover 的受控 right/manual/external-anchor 组合；保持 disclosure 的列表 `aria-expanded`。App 拥有临时固定项目身份与打开状态，固定 A 后 B 的悬停、聚焦和未完成意图不替换 A；过期关闭回调不能关闭另一项目卡。ArrowRight 进入卡片操作，Esc 恢复行焦点且不立即重开。新聊天、设置、其他弹窗取消已打开及未完成的悬停意图。
- 家目录展示取自现有 `sessions_changed.homeDir`：sidecar 启动时解析实际配置家目录的真实路径（不可解析时保留配置值），store 验证后传入 Sidebar。只按 POSIX/Windows 分隔符边界缩写，未归档会话数包含置顶。同步全部合法 envelope fixture、UI/server README、DESIGN 和 ADR-0031；沿用 ADR-0041 的精确目录归属与信任，C30 临时 UI 意图无需新 ADR。
- 聚焦证据：预改动 sidebar/layout 基线 7 passed（4.77s）；新增 App 6 cases、原有 Popover registry/composer 2 consumers 通过（8 passed，3.73s），指针存在检查后 deadline 单例通过（1.70s），跨项目固定新增 guard 单例通过（3.04s）。store 14 passed（380ms）、路径 14 passed（114ms）、真实 WS 家目录 symlink 初连与重连 1 passed（31.21ms）。现有 wire fixture 的 App 消费者 14 passed/1 failed（9.65s）；失败因固定父节点层级改变，改用语义项目组后单例通过（4.84s），未弱化归属断言。
- layout 文件复验实际为 5 passed / 1 failed（4.64s）：宽屏会话 scrollbar 的 End 在 layout.browser.test.tsx:252 留下 507px，预改动基线通过；未改实现或断言的最小单例复现随后通过（2.25s）。保留失败文件结果，不把单例通过改写为全文件通过；主代理的最终新评审修复代理需调查完成/高度同步及受影响消费者，再由 06 决定最终验收覆盖。无推测性 scrollbar 修补。
- 详细命令、red/green、性能与有效性记录位于协调记录 `/tmp/rukie-shell-palette-evidence/ticket05.md`，由 `/tmp/rukie-shell-palette-evidence/verification.md` 索引。 scoped UI/server tsc、改动 TS/TSX oxlint、150 文档检查通过；最终 package/check:dev、一次隔离 Chromium agent-browser GUI、Light/Dark/窄屏截图及 PR/CI 留给 06。未运行原生 Electron、aggregate/package suite、手动 GUI，未 push/PR/集成合并。

- 2026-10-14：复审发现未满足的焦点、作用域对比度、目录别名归属与 fixture 清理要求，重新打开本票。新的单一修复代理在 `fix/project-management-review` 完成相关增量修复；证据见 `/tmp/rukie-shell-palette-evidence/review-fixes.md`。06 与整个 spec 仍等待最终验收。

- 2026-10-14：复审修复完成并经当前 focused 验证：40 个 Project/layout 浏览器用例、14 个实际归属消费者、14 个 store 用例、10 个真实 WS/SQLite Project 用例及真实 fixture 初始化失败/清理失败路径通过适用断言；类型、scoped lint、150 文档与格式通过。旧 `project.setPrimary` 已清理；服务端统一投影真实目录身份到 nullable `projectId`，旧别名 cwd 与 Transcript 保留，异步发布按一致登记状态重新派生。C27 删除后焦点、C31 Light 对比度、徽标 4px 位移和立即/幂等 fixture 清理已修复。End 的公开测量窗口重现精确 507px 后改为读取实时内容范围；新回归与原布局终点断言通过。详细命令、真实红、无效 fixture/诊断失败和增量复用边界见 `/tmp/rukie-shell-palette-evidence/review-fixes.md`。本票恢复 resolved 表示实现及复审 scoped 要求完成；spec 和 06 尚未关闭，整包、GUI、CI 与 PR 仍由最终验收负责。
