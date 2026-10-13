# 02：重命名 Session

Status: resolved

Blocked by: 01

**What to build:** 按 [spec](../spec.md#重命名) 让用户从会话菜单重命名任意 Session：打开“重命名聊天”弹窗，保存后标题固定为用户来源；重命名未打开的 Session 时不打开 Session、不触发 Session Resume。

- [x] Agent Core store 能力新增只写标题接口：只取得该 Session 的存储写入租约，写入会话元数据标题与 `title-source` Tool State 的 user 值后立即释放；复用 Tool State 版本与写入规则和 Session Title 规范化；不创建 Session、不调度恢复、不解析模型或凭据；租约被占用时返回 session-busy 且不写入
- [x] 新增 wire 命令 `session.rename { sessionId, title }`：Session 已在本服务打开时调用其 `rename`；否则调用只写标题接口；成功后发出 `sessions_changed`；空标题与不存在的 Session 返回错误
- [x] 重命名弹窗按用户截图：标题“重命名聊天”，副标题“保持简短且易于识别”，输入框预填当前标题、全选并聚焦；去首尾空白后为空或未变化时保存禁用；Enter 保存，Esc、关闭按钮与取消关闭不修改；提交中防重复；失败时保留弹窗并显示错误，`session_busy` 显示“会话被占用”
- [x] 会话行右键、行内更多与标题栏“会话更多”加入“重命名”
- [x] zh 与 en 文案同步
- [x] 测试：store 层验证只写标题后只读列表与 Session Resume 都得到 user 来源标题且不再被自动标题覆盖、租约占用时不写入；server 测试覆盖已打开与未打开两种路径、未打开路径不产生 Run 或任务恢复、`session_busy`；shell browser 覆盖弹窗交互、保存禁用、键盘、失败保留与菜单入口

## Comments

### 实现与验证

- Agent Core 新增公开 `renameSessionTitle`：与 Session 用户改名共用规范化；只取得 host lease，在原生 storage kernel 的一次事务内提交 metadata 与 `title-source` Tool State 的 user 值，随后关闭 kernel 和 lease。它不创建 Rukie Session、不初始化输出、不清理外部文件、不启动 Harness 恢复、不解析模型或凭据。占用时不修改标题。
- `session.rename` 对已打开 Session 调用其 `rename`，未打开时调用 store 能力；成功发送 `sessions_changed`。空标题、不存在与 occupied lease 对应 `invalid_command`、`session_not_found`、`session_busy`。合同已写入 server README 与 Core API JSDoc。
- 三个菜单入口共用重命名定义。弹窗组合现有 beUI MorphingModal、Input 与 Button；没有新增依赖或修改共享 primitive 几何。预填并全选聚焦、trim 禁用、Enter 保存、三个取消入口、提交防重复、保留失败草稿与中英 busy 提示均由 App/browser fake wire 验证。
- Core 标题相关 18/18 通过（2.93s）；接口改为独立 store 函数后，新 store 三例增量 3/3 通过（2.33s）；最后补充公开 `session.toolState("title-source")` user 断言的一例通过。崩溃任务在只写标题前后完全相同。原有 writer lease 的 JSONL/SQLite 独立进程竞争例 2/2 通过（8.03s）；多个真实进程与 SIGKILL 是锁合同成本，不能使用虚拟时钟。
- Server wire 重命名两例 2/2 通过（1.73s）；未打开且 pending work 的 Session 改名后 Transcript 不变、没有 Run/Session state 事件、模型调用与凭据解密均为零；已打开路径转发 title event，外部 lease busy 保留原名。
- 浏览器改名三例通过；关联菜单例初次因 ArrowDown 计数失败，等待首项焦点后增量 1/1 通过（3.45s）。原相关运行结果为 3/4，已补充唯一失败例，不冒称重复全套通过。首次 TDD red 确认 wire 命令缺失、UI Rename 入口缺失；初始 fixture import/viewport/locator 修正和所有失败日志保留在验证记录。
- `tsc -b packages/agent packages/server packages/ui`、改动文件 oxlint/oxfmt、`check:docs`（147 Markdown files）通过。验证详情与命令日志见 `/tmp/rukie-session-sidebar-evidence/02-verification.md`；06 负责 aggregate static、desktop package 与实际 agent-browser 的 Light/Dark/窄屏验收，不重复当前有效证据。
- ADR coverage：沿用 spec 的 ADR-0035 单写者 lease 与 Session title 唯一存储来源；未打开改名不启动恢复。UI composition 为局部修改，无需新 ADR。未引入新的持久化布局或执行路径。
