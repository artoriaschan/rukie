# Agent Core 模块重构设计

状态：Q1–Q11 已确认，用户通过 to-spec 确认发布 [正式规范](spec.md) 和编号实施工单。本文保留目标结构与接口解释，实施范围与验收以正式规范和工单为准；当前代码尚未采用目标结构。决策过程见 [访谈](interview.md)。

## 目标和兼容范围

将 tools 定义为内置工具及其关联能力的集合，按能力聚合协议与执行实现，在同一目录内分开协议适配与领域规则；移除通用状态模块中的 Todo 定义，并把明确属于 Plan Mode 的行为从 Session 收回所属能力。以当前代码和公开协议基线为准，保持包公开接口、工具声明与调用结果、事件语义、Frontend 行为、Transcript 格式及恢复、取消、资源清理时序。

不全面拆分 Session，不替换锁定 pi harness，不新增运行单位或通用 controller 框架，不引入新的存储格式、兼容旧内部路径的转导出层或依赖检查框架。既有内部消费在迁移时一并更新；持久化格式和包公开导出继续兼容。实施中发现的行为问题单独记录，不能通过放宽基线断言掩盖。

## 目标目录

只列本次涉及的部分；其余顶层能力保留。下面的局部文件名可按实际实现微调，所有权与公开契约不可改变。

```text
packages/agent/src/
├── tools/
│   ├── index.ts                 # 公共构造支持与工具工厂入口
│   ├── runtime.ts               # pi 适配、错误结果包装等当前共享能力
│   ├── builtin.ts               # 基础工具集和 Hook 只读工具集构造
│   ├── path.ts                  # 现有文件工具参数规范化
│   ├── bash/
│   │   ├── index.ts
│   │   └── output-capture.ts
│   ├── web-fetch/
│   │   ├── index.ts             # 模型工具入口
│   │   ├── fetch.ts             # 原顶层抓取执行入口
│   │   └── ...                 # HTTP、地址、代理、内容转换实现
│   ├── todo/
│   │   ├── index.ts             # 工具、类型与状态定义入口
│   │   └── state.ts            # schema、版本解析和提醒
│   ├── goal/
│   │   ├── index.ts             # 能力接口与工具工厂入口
│   │   ├── controller.ts        # 状态、续跑及收尾规则
│   │   ├── state.ts
│   │   └── tool.ts             # 模型协议适配
│   ├── jobs/
│   │   ├── index.ts
│   │   ├── registry.ts          # 进程组、输出、游标与清理
│   │   └── tools.ts
│   ├── subagents/
│   │   ├── index.ts
│   │   ├── controller.ts        # 子 Session 身份与运行管理
│   │   ├── types.ts
│   │   └── tools.ts
│   ├── plan-mode/
│   │   ├── index.ts
│   │   ├── controller.ts        # 状态切换、写入顺序、回退与恢复
│   │   ├── state.ts
│   │   └── tools.ts             # Enter/Exit 工具及交互契约
│   └── ...                     # 保留 Glob、Grep、Skill、Question 工具
├── permissions/
│   ├── index.ts
│   └── review.ts               # 原 review/ 独立模型评审
├── tool-state/                 # 只保留状态注册、持久化与重放机制
└── session/
    ├── index.ts                # 对外 Session、运行与资源协调
    └── tools.ts                # 使用当前 Session 能力选择和刷新工具集
```

移除顶层 bash/、web-fetch/、goal/、jobs/、subagents/、plan-mode/、review/，以及 tool-state/todo.ts 和散落的旧工具适配文件。TodoItem、Question、PlanReview 等包级导出保持名称与含义，更新其内部来源。不为 Todo 新增 controller。权限、存储、恢复、Hook、MCP 等跨能力机制继续由各自模块拥有，不因 tools 扩大含义而迁入。

## 模块接口与责任

### 工具与领域

tools/ 按能力同时拥有协议适配与执行实现。每个能力内的工具适配拥有名称、label、description、参数 schema、输入适配、结果文本、content/details/isError 与工具执行终止标记；controller、registry 等执行模块拥有操作允许条件、状态变化、并发、持久化义务和资源生命周期。协议参数校验不能取代执行操作自身必要的不变量。

Goal 的完整能力迁至 tools/goal/，工具声明、模型控制参数校验和结果包装由 tool.ts 维护，controller 和状态定义位于同一目录。Goal 续跑及收尾上下文本身属于续跑能力，继续由执行模块生成，工具仅请求现有状态变化和收尾动作，不把模型上下文一概误判为工具结果文本。

Subagent 的完整能力归 tools/subagents/，controller 暴露现有委派、fork、发送、列举与类型查询所需的事实接口。前台执行返回子 Session 标识和 RunResult，后台执行返回启动事实，向活跃子运行发送消息返回投递事实；同目录的 tools.ts 据此保留现有结果结构与文字。list_agents 使用执行查询返回的身份与活动事实；动态 description 由工具工厂根据当前发现类型生成。类型选择、运行名额预留、每个 child 的发送串行化、取消、结算、通知与使用量归属均留在 controller。不因拆分修改早期异常、等待边界或迟到回复处理。

Jobs 的完整能力归 tools/jobs/，registry 保留当前 start/list/get/clear/dispose 等资源接口，同目录的 tools.ts 包装模型调用。Bash 和后台管理工具调用同一 registry，Session 也可以直接查询和清理，不拆分前后台进程执行。Todo 的状态定义由 tools/todo/ 导出，Session 显式注册到 tool-state/；通用状态机制不反向知道 Todo。

### Plan Mode 与 Session

Plan Mode 的完整能力归 tools/plan-mode/，状态、提醒、controller 与 Enter/Exit 工具适配同目录。controller 拥有 active、hasEntered、revision、写入队列、失败后的状态回退，以及从已重放 Tool State 恢复投影和等待写入完成的操作。父子 Session 共用同一 controller，子 Session 不另建持久化状态。

Session 提供状态读取与持久化回调，继续负责首次写入前保存 baseline、串行协调 Session Store、构造并派发 tool_state_changed 事件，以及 Run 外缓存和 Run 开始交付事件。通知必须在状态写入队列之外，事件回调再次 await setPlanMode 不得自等待。Rewind 在原有生命周期位置恢复 controller 投影和处理缓存事件；dispose、Run 结束等原有等待位置继续等待状态写入。

分离职责不意味着多加一套状态缓存或多加一条存储队列。controller 使用现有持久化事实进行失败回退，保留同值调用的等待语义和较早失败不得覆盖较晚 revision 的规则。

### 工具构造与刷新

按能力保留小型工具工厂。session/tools.ts 只整理已有组装、过滤和包装逻辑，接受当前所需能力与查询函数，不持有另一份 Session 状态，也不搬入 Run 调度、Hook 生命周期或 MCP 连接管理。

保持启动、Run 前、Turn 准备时各自的刷新范围和工具顺序。Question 依赖回调，Plan 工具依赖顶层身份与评审回调，Goal 和 Subagent 工具仅顶层存在；子类型工具限制与继承 MCP server 过滤保留。Subagent 类型发现仍依赖当前可用工具名称，并保留两者的构造顺序；动态类型描述必须随刷新更新。

Hook 继续消费独立只读工具集。MCP 连接与协议适配仍归 mcp/，可直接消费 tools/runtime.ts 中实际需要的错误包装，避免为一个 helper 导入整个工具工厂入口。Session 与其他能力可以消费 tools 下各能力的公开执行接口，无需经模型工具调用。

### 依赖约束

Session 调用能力接口与工具工厂；各能力内部由协议适配调用执行模块，执行模块依赖通用机制，不反向导入自身工具适配或全局工具组装入口。tool-state/ 不导入 Todo 等具体状态定义。跨能力通过所属能力的 index.ts 消费，能力内部允许局部文件协作；Bash 可以使用 Jobs registry，恢复模块可以使用 Subagent 事实类型。不再禁止领域模块导入 tools/ 整体。

tools 中的能力属于 Agent Core，不依赖 Frontend 的屏幕、组件、输入命令语法或呈现状态。Session 查询、事实事件与 Interaction 契约可以被 CLI、TUI、模型及测试共用，不能因调用方是 Frontend 将 Core 能力误判为 UI 逻辑。

沿用现有 Oxlint overrides 和 no-restricted-imports 限制具体路径及必要的导入名称。验证规则可拒绝实际违规，同时允许 Session、MCP、Hook 的合法使用。规则仅覆盖配置的导入路径与名称，不能宣称它已验证完整的传递依赖图。审查工具入口的转导出，防止通过另一入口绕过职责约定；不新增扫描框架。

## 验证与基线

先在未重构版本通过 createSession 与现有 fake model 固定模型可见的名称、description、parameters schema 与顺序。测试场景覆盖顶层工具集、缺少交互回调、普通及 fork 子 Session、类型过滤和动态刷新。显式提供模型回复与完成信号，不使用真实 provider、用户设置或任意时间等待。动态工具描述使用确定的临时项目与类型配置；结果中的随机 Session id、路径等验证关联事实，不固定机器相关值。

继续运行现有工具结果、事件、错误码、持久化、权限、Hooks、恢复、取消和资源清理的公开测试。已有断言能保护的契约不重复新增大面积结果快照；补充 Plan Mode 多个待写 revision 的失败组合，以及父 Rewind 后已有 child 继续 send_message 的共享状态。内部搬文件不新增结构测试。

若未重构基线出现真实行为失败，保留失败证据并区分既有问题与重构回归；相关工单不能被标为验证通过，不修改期望使新实现过关。

各阶段运行受影响的公开用例、格式、lint 和类型检查。最终清除 NO_COLOR 并使用隔离配置运行完整 bun run check，覆盖 CLI/TUI 消费者和 Knip。状态为通过必须有实际命令、退出码与结果；本次设计阶段没有执行代码测试。

## 实施工单与依赖

按下面顺序实施，每票更新当前消费者，保持可运行，不留等下一票修复的临时破坏。当前规划采用串行交付；没有要求创建 worktree、合并或清理分支，实际执行的 Git 范围另由实现请求决定。

| 工单 | 工作与验收重点                                                                                   | 依赖 |
| ---- | ------------------------------------------------------------------------------------------------ | ---- |
| 01   | 固定公开工具声明基线；核查并补齐 Plan Mode 关键时序；先验证旧实现                                | 无   |
| 02   | 拆出 tools/runtime.ts 和基础/只读工具构造，更新 MCP 与 Hook 消费，保持错误和 pi 适配行为         | 01   |
| 03   | 迁移 Bash、Web Fetch、Todo 与完整 Jobs 能力；Permission Review 收进 permissions/；更新全部消费者 | 02   |
| 04   | Goal 完整能力迁至 tools/goal/，内部区分 controller 与工具适配，保留续跑规则                      | 03   |
| 05   | Subagent 完整能力迁至 tools/subagents/，分开事实接口与四个工具包装，保持全部运行时序             | 04   |
| 06   | Plan Mode 完整能力归 tools/plan-mode/，提取 controller 并保持共享、Rewind 和生命周期等待         | 05   |
| 07   | 整理 Session 内部工具组装点，加入准确的 Oxlint 约束，同步工程规则与当前架构文档                  | 06   |
| 08   | Standards/Spec 审查及最终完整检查，核对删除项、公开契约与工单证据                                | 07   |

文档中持久的归属与依赖取舍记录为 ADR，实施范围与测试清单归本功能 spec 和工单；当前架构文档随实现同步，不提前写成已交付事实。领域概念与语义未改变，因此不为工程目录新增 CONTEXT.md 术语。

## 完成条件

- 所有受影响入口与消费者使用目标归属，旧目录和旧内部转导出删除。
- 领域返回执行事实，工具包装保留公开协议，通用状态机制不包含 Todo。
- Plan Mode 和 Subagent 的存储、取消、父子与恢复时序经公开行为验证，Bash 保留同一进程路径。
- 动态工具集与包导出兼容，CLI/TUI 视觉及交互保持。
- 静态约束可命中目标违规，合法 MCP/Hook 调用可通过；架构、工程规则、票状态及证据一致。
- 完整检查通过，审查无未解决的范围内问题；不能仅以目录移动完成宣称重构完成。
