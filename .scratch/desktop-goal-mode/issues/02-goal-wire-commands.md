# 02：Goal wire 命令

Status: resolved
Blocked by: 01

**What to build:** 按 [spec](../spec.md) 的「wire 与 server」一节，开放桌面端和 Web 端创建、暂停、继续与清除 Goal 的能力。

- [x] `session.create` 新增可选字段 `goal: true`：调用 `createGoal(text, { images })`；只在 `goal: true` 时允许空文本，此时 `images` 至少一项
- [x] 新增 `session.goal_create`、`session.goal_pause`、`session.goal_resume`、`session.goal_clear`，在 server 中完成校验与分发
- [x] Goal 的 UserVisibleError 错误码沿用现有的回传方式，并补入客户端错误码白名单
- [x] 不新增事件；确认 snapshot 与 `tool_state_changed` 中的 `toolStates.goal` 带上 version 2 的字段
- [x] 更新 `packages/server/README.md` 和 `packages/shared` 的 wire 类型
- [x] 测试：新聊天 goal 创建、四个命令、空文本加图片校验、错误码、状态推送；`bun test packages/server packages/shared`

## Comments

### Implementation evidence

- `feat/desktop-goal-wire` 基于集成 `66c99c9`。shared schema 提供 `goal: true` 与四个 Session Goal 命令，空文本仅允许图片 Goal；server 直接追踪 Core 返回的 requestId，复用模型认证、准入与关闭路径，不重复提交 prompt。
- Goal 和图片校验错误使用共享安全白名单贯通 server、client 与通用 zh/en 错误呈现。Core 仅在 Goal 的 availability 边界返回 `goal-busy`，其他 Session API 的忙碌行为保持原样。snapshot/live Tool State 直接转发，未增加事件。
- TDD：parser 首次拒绝 Goal，修复后 5 pass / 43 assertions；真实 WS lifecycle 首次没有 Goal 状态，修复后 Goal group 3 pass / 28 assertions，2.09s，覆盖文本图片、新聊天、已有图片目标、暂停/继续/清除保留当前 Run、requestId 结算、接管 snapshot、被动历史、错误码与安全参数、上限与完成错误。Core busy 2 pass / 16 assertions，2.39s；client Node 7 pass，695ms；zh/en error presenter Node 2 pass，1.30s。
- 必需 `bun test packages/server packages/shared` 实际结果：107 pass / 1 fail / 774 assertions，26.40s。唯一失败为已有工作树测试在恢复仓库目录时遇到 ENOTEMPTY；Goal 用例通过。最小单例仍复现；基线集成同例通过，故未仅凭目录所有者未改就判为无关。
- 最小临时追踪发现目标目录仅被外部写入 `.git/ai/working_logs/initial`，没有命中 Node mkdir；Git 为 `/usr/bin/git`，用户全局 `trace2.eventTarget` 指向 git-ai daemon。单进程 `GIT_TRACE2_EVENT=0` 的同例尝试在首个断言前超时，未证明禁用后通过。追踪代码已还原，无用户配置、产品或原断言变更。保留包级失败，等待最终评审与远端环境证据；不重跑整包。
- 受影响 `tsc -b packages/agent packages/server packages/ui`、changed-file oxfmt/oxlint、docs:update、check:docs（155）、check:test-policy（455）、diff --check 通过。初次类型检查仅发现 parser 测试字面量拓宽，const 修正后通过。复用 `66c99c9` 的 aggregate check:dev；无依赖变化，新增导出由 server/client/presenter 消费。UI 错误呈现的浏览器组合验收归后续 UI 工单。
- 外部完整记录与日志：`/tmp/rukie-desktop-goal-mode-evidence/verification.md`、`wire-*.log`。工单保持 claimed，最后测试勾选和最终关闭由集成协调者按实际门禁结果处理。

### 最终交付关闭

- 命令、校验、安全错误白名单、状态推送与受影响文档完成，两轴评审无 wire 确认问题；请求等待沿用 ADR-0033/0031，Core 保持完成事实所有权，见 [spec 的 ADR Coverage](../spec.md#adr-coverage)。
- 测试勾选表示要求的验证已执行并完成结果处置：parser、真实 WS Goal 生命周期、Core busy、Node client/presenter focused 通过；初始 `check:dev` 与后续受影响静态检查通过。必需 server/shared 包结果仍为 **107 pass / 1 fail**，上文外部写入和超时调查没有证明本地包已全绿。canonical general 518 pass/10 fail、coding 1512 pass/32 fail 同样保持失败。
- Core e2e 1510 pass、准入/恢复/时间/runtime 增量 43 pass、桌面 53 文件/306 测试及最终 App 12 例、Chromium Light/Dark/窄屏（0 page errors，150 请求/0 失败）构成适用组合证据，按差异复用。后端 `64ea0ef` 独立 CI 全绿只适用于该提交；最终推送后最新 HEAD CI 待验收。与其余票和 spec 同时 resolved，不表示包级失败被改写或 PR 已合并。
