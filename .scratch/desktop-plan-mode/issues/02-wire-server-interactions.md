# 02：wire 与 server 接入问题、计划评审与计划模式

Status: ready-for-agent

Blocked by: 01

**What to build:** 按 [spec](../spec.md#wire-与-server) 的要求，把桌面 server 接上 `onQuestion` 和 `onPlanReview`，并扩展 wire 协议，让 UI 能收到这两类交互、发回回复，并能切换计划模式。

- [ ] `@rukie/shared`：
  - 新增 `session.set_plan_mode { sessionId, on }`
  - `session.create` 增加可选的 `planMode`
  - `interaction_requested.request` 改为按 `kind` 区分的联合类型：`permission`、`question`、`plan_review`
  - `interaction.reply` 改为按交互种类区分回复，并用 TypeBox 校验
- [ ] server pending 表扩展到三种交互：
  - 按会话排队，订阅或重连时回放
  - epoch 过期时返回 `interaction_stale`
  - 回复种类与请求不符时返回错误码
  - Run 被取消时按安全默认值结算：deny、declined、takeover
- [ ] `createSession` 传入 `onQuestion` 和 `onPlanReview`，子智能体发起的请求带上 `origin`
- [ ] 把 `waitingPermission` 改名为 `waitingInteraction`，并同步更新 shared、server、storage 和 ui 中的所有使用处与测试
- [ ] `set_plan_mode` 调用 `session.setPlanMode`；`session.create` 带 `planMode` 时，在第一次 Run 之前生效
- [ ] 更新 server README 和 ui README 中的协议说明
- [ ] 测试：
  - 三种交互的排队、回放、stale 和种类不符
  - 取消时的默认结算
  - 用 fake model 跑通 `exit_plan_mode` 的 approve、revise、takeover
  - `ask_user_question` 的作答与 declined
  - 创建会话时带 `planMode`，第一次模型调用就收到 plan reminder
  - `set_plan_mode` 在空闲和运行中都能生效
