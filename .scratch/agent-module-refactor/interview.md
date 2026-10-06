# Agent Core 模块重构访谈

日期：2026-10-07

状态：Q1–Q11 已确认，用户通过 to-spec 确认转为正式规范。[Spec](spec.md) 与编号实施工单已发布；此记录保留设计过程，不表示已开始生产代码实现。

## 原始已确认决策

以下 Q1–Q11 保留原始访谈记录。涉及顶层目录与 tools 分离、导入禁止范围的决定已被后续调整覆盖；当前约定见下面的“后续调整”和正式 Spec。

### Q1：内置工具入口集中在 tools/

用户确认采用推荐方案 A：所有内置模型工具的声明、参数处理和结果包装归 tools/；Goal、Background Job、Plan Mode、Subagent 等领域模块拥有领域规则、状态和资源生命周期。工具调用领域模块。MCP 发现及协议适配仍由 mcp/ 负责。

选择集中入口而非各领域各自持有 tools.ts，以统一模型调用协议的落点。代价是部分领域的工具入口与领域实现分属不同目录。通用工具包装与工具集组装的具体接口仍待确定；不以禁止所有模块导入 tools/ 代替对调用职责的判断。

### Q2：同时修正目录与明确的职责问题

用户确认采用推荐方案 A：统一工具归属，移出 tool-state/ 中 Todo 的具体定义，消除为复用辅助函数而依赖工具组装入口的问题，并抽出 Session 中明确属于领域模块的行为。本轮不全面重新设计 Session 的运行架构，不以文件行数或目录数量为完成指标。具体抽取范围待下一轮确认。

### Q3：严格保持对外契约

用户确认采用推荐方案 A：保留包公开接口、工具名称与参数、结果内容、事件语义、Transcript 格式、恢复与取消行为；内部接口可以调整。当前行为问题单独记录和处理，不混入结构重构。

### Q4：Web Fetch 整体归 tools/web-fetch/

用户确认采用推荐方案 A：工具入口、HTTP、地址校验、代理和内容转换整体置于 tools/web-fetch/，保留内部文件分工。当前只有该工具执行抓取，不为假设的复用保留顶层 web-fetch/。

### Q5：Todo 整体归 tools/todo/

用户选择方案 B，覆盖此前建立顶层 todo/ 的推荐：工具入口、schema、类型、状态版本解析与提醒都归 tools/todo/。tool-state/ 仅负责通用状态机制，不直接内置或转导出 Todo 定义。Session 在组装时注册 Todo 的状态定义；包级 TodoItem 导出保持兼容。Todo 有持久化状态并不要求建立顶层领域目录，也不为结构对称增加 controller。

### Q6：限定 Session 职责抽取范围

用户确认采用推荐范围：Goal、Jobs、Subagent 的工具声明与包装移至 tools/；Plan Mode 的状态切换、写入串行化、失败恢复和状态恢复接口移至 plan-mode/。Session 保留存储协调、事件派发、Run 调度、恢复流程与资源生命周期。本轮不全面拆分 Run 调度或恢复流程。Plan Mode 抽取必须保留父子 Session 共用状态、Rewind、Run 外事件缓存、关闭时等待写入完成的时序。

### Q7：Permission Review 归 permissions/review.ts

用户确认采用推荐方案 A：将 review/ 的实现收进 permissions/review.ts，保留独立模型调用、失败转 ask、取消和安全默认行为。

### Q8：领域接口返回执行事实

用户确认采用推荐方案 A：Subagent 等领域模块返回执行事实与状态，由 tools/ 转换为现有工具结果；领域模块不负责模型结果文本、content/details/isError 包装。并发限制、取消、持久化与运行管理仍归领域模块。只提取当前调用所需的操作，不引入通用 controller 框架。通用 Session RunResult 等已有事实类型可以继续使用，不将其误判为模型工具协议。

### Q9：按能力构造工具，Session 内部组装

用户确认采用推荐方案 A：各能力分别提供工具工厂，Session 内部组装模块负责选择、组合与刷新；Hook 的只读工具集保留独立构造入口。不引入接收所有能力和运行状态的单一大工厂。Frontend 回调缺失、父子角色、子代理类型与继承工具范围、Plan Mode、MCP 发现影响工具可用性的时机保持不变。

### Q10：文档与现有 Oxlint 静态约束共同维护方向

用户确认采用推荐方案 A：使用现有 no-restricted-imports 与文件范围配置，禁止明确的反向依赖，例如 Goal、Jobs、Subagent、Plan Mode 导入工具组装入口，以及 tool-state/ 导入 Todo 定义。MCP 工具协议适配、Hook 只读工具集消费保留明确允许的路径。不新增依赖检查框架，不笼统禁止所有模块导入 tools/。TypeScript 项目引用不能单独约束 Agent Core 内部模块方向。

### Q11：先固定公开协议基线，再重构

用户确认采用推荐方案 A：通过 createSession 和 fake model 固定模型可见的工具名称、description、parameters schema 与顺序，覆盖顶层、子代理、交互回调缺失和动态刷新；输出、事件与持久化沿用现有公开行为测试。核查并补齐 Plan Mode 的多个待写 revision 失败组合，以及父 Rewind 后已有子 Session 继续运行的共享状态。仅补充真实契约与时序缺口，不增加搬文件或内部结构测试，不放宽已有断言。分阶段验证，最终运行完整 bun run check。

## 后续调整：tools 按能力聚合

2026-10-07 用户明确要求“还是都放到 tools 下面吧，修改下 tools 的含义”。tools 现定义为内置工具及其关联能力的集合：Goal、Jobs、Subagent、Plan Mode 的状态与执行实现连同协议适配一并放入各自能力目录。目录内部仍分开 controller/registry/state 与工具适配，Session 可以直接调用执行接口，不必构造模型工具调用；资源生命周期和存储、事件协调仍由 Session 管理。

此调整覆盖原始 Q1 对外层领域与工具入口分离的目录决定、Q6 的 Plan Mode 目标位置，以及 Q10 中以整个 tools 目录为禁止对象的导入约束。约束改为执行模块不得反向依赖自身协议适配或全局组装入口，通用状态机制不得依赖具体定义；跨能力经能力入口消费，MCP、Hook 与 Session 真实调用被允许。Agent Core 不依赖 Frontend 的屏幕、组件、命令语法和呈现实现。公开契约、测试接缝、八票顺序与其余生命周期约束保持。

## 当前证据与约束

- [ADR-0002](../../docs/adr/0002-reuse-pi-agent-core-harness.md)：继续复用锁定的 pi harness 能力，不借本次重构替换 Agent loop 或 read/write/edit 实现。
- [ADR-0010](../../docs/adr/0010-own-bash-tool-for-background-jobs.md)：Bash 前后台共用进程执行路径，Background Job 资源归 Session 管理；未规定 Bash 实现必须放在顶层目录。
- [ADR-0003](../../docs/adr/0003-dual-session-store.md)：保留 Session Store 接口及原生 Transcript 格式。
- [ADR-0009](../../docs/adr/0009-subagent-resume-outcomes.md)：保留 Subagent 恢复、Run Outcome 与缺失工具结果的不确定性，不借结构调整自动重放历史调用。
- tools/index.ts 同时包含工具适配、错误包装和工具组装；goal/ 与 mcp/ 为错误包装而依赖该入口。hooks/model.ts 使用 createReadonlyTools 是真实的工具集消费场景，不能仅因导入 tools/ 判定为错误。
- Subagent 的工具声明与运行管理同处 subagents/index.ts；按 Q1，工具声明与包装也须纳入本次迁移，运行管理仍归 subagents/。
- Todo 的 schema、状态解析与提醒位于 tool-state/todo.ts；Plan Mode 的写入串行化与失败恢复位于 session/index.ts。
- 当前 architecture.md 允许工具在所属模块、tools/ 或 Session 组装；Q1 是对现行组织约定的调整，不是修复一条早已明确的禁止规则。
- 当前找到的 fetchWeb 生产执行调用方只有 tools/web-fetch.ts。包设置 private: true，公开入口为 src/index.ts；仓库消费者使用包入口，尚未找到内部路径存在仓库外消费者的已记录证据，这不等于证明仓库外没有消费者。
- Plan Mode 提取还涉及父子 Session 共用 controller、提醒生成、Rewind 状态恢复、Run 外缓存事件和多个生命周期对写入完成的等待；仅搬出 setMode 函数不足以保持当前时序。
- Oxlint 已支持文件范围 overrides 与 no-restricted-imports 的路径/模式配置，但它约束导入字符串，并非已验证的完整模块依赖图；实施时必须验证目标违规能被拒绝、MCP/Hook 合法消费仍能通过。
- 工具组装在启动、Run 前和 Turn 准备时具有不同刷新范围；Subagent 的 description 随发现类型更新。迁移不能改成启动时一次性构造。

## 验证事实

本次只读核查确认下列测试源码与断言存在，未运行这些代码测试，不表示当前基线已经通过。

- Plan Mode：packages/agent/tests/e2e/plan-mode.test.ts 覆盖 Run 内外切换、恢复、父子共享、Compaction、Rewind、事件回调再次切换、单次保存失败与重试；plan-review.test.ts 与 enter-plan-mode.test.ts 覆盖工具可用性、权限、取消、晚回复和混合工具批次。
- Todo：todo.test.ts 与 todo-reminders.test.ts 覆盖结果文本、事件、规范化、非法输入、恢复、清空、提醒和 Compaction。
- Subagent：subagents.test.ts、subagent-fork.test.ts、subagent-types.test.ts、subagent-outcomes.test.ts 与 subagent-reconciliation.test.ts 覆盖运行结果、取消、并发、工具继承与选择、动态描述和恢复事实。
- Bash/Jobs：tools.test.ts、background-jobs.test.ts、job-api.test.ts、job-notifications.test.ts 与 subagent-jobs.test.ts 覆盖前后台输出、超时提升、游标、进程组清理、通知、Session API 与子运行清理。
- Web Fetch：web-fetch.test.ts、web-fetch-redirects.test.ts、web-fetch-proxy.test.ts、web-fetch-html.test.ts 与 web-fetch-permissions.test.ts 覆盖请求、转换、权限、重定向、代理与取消。
- 尚未证实所有内置工具完整声明均有统一公开协议基线；Plan Mode 的多个待写 revision 混合失败组合、父 Rewind 后同一已存在 child handle 继续运行的状态共享也尚未证实有完整覆盖。基于上述事实确定最小必要的补充验证，不通过修改原断言迁就新实现。

## 原始决策树与发布记录

- 工具入口集中（Q1 已确认）→ Web Fetch 私有执行实现归 tools/web-fetch/（Q4 已确认）→领域接口返回事实（Q8 已确认）、按能力工具工厂与 Session 内部组装（Q9 已确认）。
- 通用状态机制与领域定义分离（Q2 已确认）→ Todo 整体归 tools/todo/（Q5 已确认）。
- 有界的职责重构（Q2 已确认）→ Session 抽取范围（Q6 已确认）、Permission Review 归 permissions/（Q7 已确认）。
- 对外契约保持（Q3 已确认）→文档和现有静态检查约束方向（Q10 已确认）→公开协议基线与补充验证（Q11 已确认）→交付条件与实施依赖见 [完整设计](design.md)。
- 所有设计分支已确定，用户通过 to-spec 确认生成实施规范与编号工单。此次交付为规划文档。

工程目录与内部技术接口写入架构文档或工程规则，不加入 CONTEXT.md 的领域词汇。只有确实改变或补齐领域概念时才修改 CONTEXT.md。是否新增 ADR 在完整决策明确后按持久性和取舍判断。

Q1–Q11 均已确认；2026-10-07 用户调用 to-spec，确认将完整设计整理为 [Spec](spec.md) 和八个编号工单，持久的模块归属与取舍记入 [ADR-0011](../../docs/adr/0011-agent-module-ownership.md)。后续实施与验收以规范和工单为准。
