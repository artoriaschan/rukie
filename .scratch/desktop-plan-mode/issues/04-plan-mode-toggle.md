# 04：C09 计划模式开关与 C39 状态

Status: ready-for-agent

Blocked by: 02

**What to build:** 用户可以在 C09 开关计划模式，在 C04 看到 C39 状态，也可以在首页新聊天预先开启。几何以 rukie.pen 的 C09（`AkFfA`）、C39（`VrDSP`、`k69wn`）为准。

- [ ] C09：在附件之后加入「计划模式」行，图标为 `list-todo`。
  - 点击后切换状态并关闭菜单。
  - 副文案在「已关闭」和「• 已开启」之间切换。
- [ ] C39：显示在权限模式触发器右侧，28px 高。
  - 悬停或聚焦时切换为关闭态。
  - 点击发送 `set_plan_mode(false)`，不清空草稿。
- [ ] 状态来源：已有 Session 时读取 snapshot 的 `planMode` 和 `tool_state_changed { name: "plan" }`；首页使用本地预选状态，在 `session.create` 时带入。
- [ ] 中英文文案。
- [ ] DESIGN.md：改写 C09 中“only the implemented image attachment action”这条约束，补充 C39 规则。
- [ ] Chromium 测试：
  - 开关切换与副文案
  - C39 出现与悬停关闭，以及无障碍名称
  - 首页预先开启后，创建命令带有 `planMode`
  - 模型调用 `enter_plan_mode` 获批后，C39 出现
  - 布局回归：C04 底栏的其他控件位置不变
