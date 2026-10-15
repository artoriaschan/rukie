# 02：wire 与 server 接入问题、计划评审与计划模式

Status: resolved

Blocked by: 01

**What to build:** 按 [spec](../spec.md#wire-与-server) 的要求，把桌面 server 接上 `onQuestion` 和 `onPlanReview`，并扩展 wire 协议，让 UI 能收到这两类交互、发回回复，并能切换计划模式。

- [x] `@rukie/shared`：
  - 新增 `session.set_plan_mode { sessionId, on }`
  - `session.create` 增加可选的 `planMode`
  - `interaction_requested.request` 改为按 `kind` 区分的联合类型：`permission`、`question`、`plan_review`
  - `interaction.reply` 改为按交互种类区分回复，并用 TypeBox 校验
- [x] server pending 表扩展到三种交互：
  - 按会话排队，订阅或重连时回放
  - epoch 过期时返回 `interaction_stale`
  - 回复种类与请求不符时返回错误码
  - Run 被取消时按安全默认值结算：deny、declined、takeover
- [x] `createSession` 传入 `onQuestion` 和 `onPlanReview`，子智能体发起的请求带上 `origin`
- [x] 把 `waitingPermission` 改名为 `waitingInteraction`，并同步更新 shared、server、storage 和 ui 中的所有使用处与测试
- [x] `set_plan_mode` 调用 `session.setPlanMode`；`session.create` 带 `planMode` 时，在第一次 Run 之前生效
- [x] 更新 server README 和 ui README 中的协议说明
- [x] 测试：
  - 三种交互的排队、回放、stale 和种类不符
  - 取消时的默认结算
  - 用 fake model 跑通 `exit_plan_mode` 的 approve、revise、takeover
  - `ask_user_question` 的作答与 declined
  - 创建会话时带 `planMode`，第一次模型调用就收到 plan reminder
  - `set_plan_mode` 在空闲和运行中都能生效

## Comments

- 2026-10-15：共享 wire 以 `request.kind` 和 `interaction.reply.kind` 区分 permission / question / plan_review；回复 payload 沿用 Core 的权限字符串、QuestionReply 与 PlanReviewResult。TypeBox 负责结构验证，server 再核对问题数量、单/多选数量与选项标签；错误不消费挂起请求。旧 epoch 与已结算 epoch 返回 stale。所有 summary/storage/UI 使用方改为 waitingInteraction，不保留旧字段或旧命令形状。
- 2026-10-15：三类回调共用按创建顺序保存的 pending 表，重连订阅回放，取消时分别返回 deny / declined / takeover 并移除 epoch；来源 origin 随 payload 保留。创建时 planMode 在第一次 Run 前写入，set_plan_mode 支持空闲和运行中修改；不改 Permission Mode。UI store 保存联合请求并从 snapshot/plan Tool State 投影 planMode；本票仅让现有权限卡消费 permission 子集，问题和计划评审组件由后续票据接入。
- 2026-10-15：公开 wire / server WS fake-model Session / UI store 边界完成 focused 验证：server 与 wire 16 pass，UI store 15 pass；scoped shared/server/ui tsc 通过，check:docs 通过（155 Markdown 文件）。现有权限 epoch、规则批量结算、后台等待/取消，问题重连/答案校验、计划 approve/revise/takeover、计划取消和子代理问题来源均有证据。详细状态、red/green、日志、耗时与增量复验范围保存在本次外部验证目录 ticket-02-verification.md；最终集成静态检查、desktop 包验收和浏览器验收由主代理协调。
- ADR Coverage：沿用 spec 中 ADR-0015（Frontend 回调、安全默认、Plan Mode 独立）、ADR-0031（同一 WS、命令校验、identity/epoch 与重连回放）和 ADR-0016（Tool State 投影）；本票没有新增持久化状态或改变 Core 交互语义，无需新增 ADR。
