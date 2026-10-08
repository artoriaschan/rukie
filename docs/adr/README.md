# 决策记录

ADR 保存长期架构决定、真实备选方案和代价。当前运行行为归架构、能力参考与包 README；需求、调查、实施票和验证证据归 `.scratch/`。工程流程归 `docs/agents/`，可复用的操作流程归仓库 skill。

## 格式

文件命名为 `NNNN-topic.md`，编号递增，已有文件保持路径稳定。文件开头使用 YAML `status`，正文依次包含一个标题和非空的 `问题`、`决定`、`备选方案`、`影响` 二级章节。按主题需要增加小节；[决策模板](../../.agents/skills/rukie-doc/templates/decision.md)提供骨架。

| status       | 含义             | 维护动作                                 |
| ------------ | ---------------- | ---------------------------------------- |
| `proposed`   | 尚待确认的决定   | 决定章明确拟议行为、未解决问题及确认条件 |
| `accepted`   | 已接受的决定     | 保留决定与取舍，事实随实现同步维护       |
| `rejected`   | 已否决的提案     | 决定章记录拒绝理由及仍有价值的限制       |
| `superseded` | 整份决定已被替代 | 链接替代 ADR，新 ADR 回链旧记录          |

`accepted` 表示设计已接受，不表示已经实施或通过验收。实施状态与验证证据引用对应 `.scratch/` 工单；当前支持的行为以拥有该行为的文档和实现为准。部分替代在原记录中明确剩余有效内容与替代链接，原状态保持 `accepted`；例如 ADR-0006 的渲染管线复用范围由 ADR-0013 替代，全屏、阅读位置与输入规则继续生效。

## 维护

先查相关 ADR，再决定更新还是新建。路径、符号、默认值和实现位置变化时更新原决定的事实；改变决定或取舍时新建 ADR 并记录替代关系。已接受记录描述已确定的义务，将临时计划、任务清单和访谈经过链接到 `.scratch/`。

备选方案只记录真正讨论过的选择及其未采用理由。历史记录缺少备选方案时明确标注缺失，不补造论证。机械修改和局部呈现调整不单独创建 ADR；需要保存长期所有权、恢复、持久化、权限或架构取舍时才记录。

`bun run check:docs` 检查元数据、命名、标题、必需章节和本地链接。它验证格式与引用，不判断决定是否正确、已经实施或仍符合源码；这些由[文档流程](../agents/documentation.md)的事实核对与审阅完成。

## 决策索引

下列索引从各 ADR 的标题和 status 生成。运行 `bun run docs:update` 同步新增、删除、改名与状态变化；`check:dev` 在格式检查前自动执行同步，`check:docs` 只读检查索引是否过期。生成器只改标记之间的内容，其余规则由人工维护。规格关闭前的决定覆盖审阅见 [ADR coverage](../agents/issue-tracker.md#adr-coverage-before-delivery)。

<!-- ADR_INDEX_START -->

- [0001 Agent 运行在 Bun sidecar 进程，而不是 Electron main](0001-agent-runs-in-bun-sidecar.md) — `accepted`
- [0002 复用 pi-agent-core 的 harness 组件，不用 pi-coding-agent，也不完全自研](0002-reuse-pi-agent-core-harness.md) — `superseded`
- [0003 Session Store：headless 用 JSONL，桌面端用 SQLite，两者共用一个接口](0003-dual-session-store.md) — `accepted`
- [0004 测试跑在生产代码所在的运行时上：Bun 代码用 bun:test，Electron 和渲染进程用 Vitest](0004-test-runner-per-runtime.md) — `accepted`
- [0005 TUI 渲染器自研：React reconciler → 纯 TS Yoga → cell 网格 → 帧差分 → ANSI](0005-own-tui-renderer.md) — `superseded`
- [0006 TUI 使用全屏消息区与底部输入区](0006-fullscreen-tui.md) — `accepted`
- [0007 auto-review 只用 LLM 评审，失败转 ask](0007-auto-review-llm-only.md) — `accepted`
- [0008 Agent Core 不做本地化，文案由 @rukie/i18n 与各 frontend 字典完成](0008-locale-agnostic-agent-core.md) — `accepted`
- [0009 Subagent 恢复保留对话与结束原因，续跑由新消息触发](0009-subagent-resume-outcomes.md) — `accepted`
- [0010 bash 工具改为自研，以支持 Background Job](0010-own-bash-tool-for-background-jobs.md) — `accepted`
- [0011 tools 按能力聚合工具与执行实现，Session 负责协调](0011-agent-module-ownership.md) — `accepted`
- [0012 Headless CLI、TUI 与终端渲染栈合为一个 coding-agent 包](0012-single-coding-agent-package.md) — `accepted`
- [0013 终端渲染栈改用 dsh-TUI 的 ink](0013-adopt-dsh-tui-ink.md) — `accepted`
- [0014 显式权限规则先于模式默认值，项目授权受信任闸门约束](0014-permission-rules-and-project-trust.md) — `accepted`
- [0015 Agent Core 发起 Interaction，Plan Mode 独立于权限模式](0015-frontend-interactions-and-plan-mode.md) — `accepted`
- [0016 Tool State 保存完整事实快照，模型上下文按当前分支投影](0016-tool-state-and-context-projection.md) — `accepted`
- [0017 Checkpoint 归真实用户输入，Rewind 保留对话分支](0017-checkpoint-and-branch-rewind.md) — `accepted`
- [0018 Goal 持久化目标事实，自动续跑只由当前进程显式开启](0018-goal-state-and-idle-scheduling.md) — `accepted`
- [0019 MCP OAuth 归 Agent Core，凭据按用户与服务器身份隔离](0019-mcp-oauth-credential-ownership.md) — `accepted`
- [0020 文件变更基线表示模型已知内容，与提醒在同一事务中推进](0020-file-tracking-baseline-transactions.md) — `accepted`
- [0021 图片输入保存原生内容块，Frontend 管理附件交互与终端资源](0021-native-image-input-persistence.md) — `accepted`
- [0022 WebFetch 在执行层限制公网请求，跨源跳转重新授权](0022-public-web-fetch-network-boundary.md) — `accepted`
- [0023 coding-agent 通过 npm 分发 Bun 可执行文件，以 Release PR 控制发布](0023-npm-cli-distribution.md) — `accepted`
- [0024 采用 pi-durable 原生执行与恢复，移除旧 harness 和数据兼容](0024-adopt-pi-durable-harness.md) — `accepted`
- [0025 Tool Search 在客户端执行，经 pi 原生工具变更加载 Deferred Tool](0025-client-side-tool-search.md) — `accepted`
- [0026 Tool Search 独立于原生追加能力，按模型 compat 选择工具声明格式](0026-protocol-independent-tool-search.md) — `accepted`
- [0027 原生工具追加能力通过独立请求探测，失败时使用普通工具声明](0027-native-tool-capability-probing.md) — `accepted`

<!-- ADR_INDEX_END -->
