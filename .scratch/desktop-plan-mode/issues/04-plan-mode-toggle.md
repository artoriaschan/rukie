# 04：C09 计划模式开关与 C39 状态

Status: resolved

Owner: fresh subagent `ticket04_toggle`, worktree `/tmp/rukie-plan-04`, branch `feat/desktop-plan-toggle`.

Blocked by: 02

**What to build:** 用户可以在 C09 开关计划模式，在 C04 看到 C39 状态，也可以在首页新聊天预先开启。几何以 rukie.pen 的 C09（`AkFfA`）、C39（`VrDSP`、`k69wn`）为准。

- [x] C09：在附件之后加入「计划模式」行，图标为 `list-todo`。
  - 点击后切换状态并关闭菜单。
  - 副文案在「已关闭」和「• 已开启」之间切换。
- [x] C39：显示在权限模式触发器右侧，28px 高。
  - 悬停或聚焦时切换为关闭态。
  - 点击发送 `set_plan_mode(false)`，不清空草稿。
- [x] 状态来源：已有 Session 时读取 snapshot 的 `planMode` 和 `tool_state_changed { name: "plan" }`；首页使用本地预选状态，在 `session.create` 时带入。
- [x] 中英文文案。
- [x] DESIGN.md：改写 C09 中“only the implemented image attachment action”这条约束，补充 C39 规则。
- [x] Chromium 测试：
  - 开关切换与副文案
  - C39 出现与悬停关闭，以及无障碍名称
  - 首页预先开启后，创建命令带有 `planMode`
  - 模型调用 `enter_plan_mode` 获批后，C39 出现
  - 布局回归：C04 底栏的其他控件位置不变

## Comments

- 2026-10-15：复用现有 beUI Button/PromptInput 和 DropdownMenu，C09 在附件后显示计划开关与本地化状态，选择后关闭菜单。C39 紧随权限触发器，28px，悬停与聚焦切换 x/胶囊，关闭保留草稿和权限模式。固定关闭态占位避免悬停位移。
- 2026-10-15：首页预选进入 session.create.planMode；创建失败保留预选和草稿。已有 Session 从 view.planMode（snapshot/plan Tool State）投影，不做本地乐观覆盖，开关发送 session.set_plan_mode。模型 enter_plan_mode 仍经权限卡批准；结果 Tool State 显示 C39。为03添加可选 footer interaction 参数，保留权限卡宽度，问题/评审容器为752px。
- 2026-10-15：三个公开边界 TDD 红绿切片通过；Composer 8 项通过，App 4 项通过，后续真实窄屏调整仅复验已有会话参数化2项通过。覆盖中英文、Light/Dark、420px无溢出、C09与C39、草稿、创建失败重试、snapshot/Tool State、批准后的状态及相邻工具栏/C32几何。scoped ui tsc、改动文件lint/format、docs:update/check:docs通过。完整命令、失败修正和日志在本次外部 ticket-04-verification.md；最终集成静态、desktop包与手动浏览器验收由主代理统一协调。
- ADR Coverage：沿用 spec 的 ADR-0015（Plan Mode 与 Permission Mode 独立）、ADR-0031（既有 WS 命令）和 ADR-0016（Tool State 投影）；首页预选为本地呈现状态，不新增持久化或改变 Core 语义；C09/C39几何由 DESIGN.md 维护，无需新 ADR。
