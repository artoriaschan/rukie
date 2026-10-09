Status: resolved

# Spec: Agent Core 深化重构

术语见 `CONTEXT.md` 的 Request、Session、Run、Turn、Transcript、Tool State、Goal、Subagent、Interaction、Deferred Tool、Tool Search。架构约束见 [ADR-0011](../../docs/adr/0011-agent-module-ownership.md)、[ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)、[ADR-0026](../../docs/adr/0026-protocol-independent-tool-search.md)。

## Problem Statement

`packages/agent/src/session/index.ts` 是一个约 3900 行的 `createSession` 闭包，约 40 个可变状态集中声明后被所有职责簇直接读写，内部没有 seam。最近 80 次 `src/` 提交中 48 次触及该文件，恢复与结算类修复集中在调用点：请求身份字符串在约 15 处被反解析，root 与 child Conversation 的工具策略逐段镜像，工具 loadout 在两处装配、四处规划，Goal 的激活与轮次规则写在 Session 中。这些逻辑只能经完整 `createSession` Run 和崩溃 worker 测试。

## Solution

按依赖顺序把职责簇收进 deep module，Session 只保留组合、公开 `Session` 对象与生命周期：

1. Request Ledger（`src/requests/`）拥有 Request 身份、绑定、因果与结算。
2. Goal 续跑归 `tools/goal`，Session 只提供 submit/settle adapter。
3. Conversation Runtime（`session/conversation/`）为 root 与 child 统一装配工具策略。
4. Tool Loadout 在 `session/tools.ts` 原地深化。
5. Interaction 拥有 pending interaction 的写入与识别。
6. `tools/` 根目录支撑代码收进 `tools/support/`，`prompt/` 并入 Session。

MCP 拆深（catalog 与 OAuth 授权）不在本 spec 范围，另行立项。

## Implementation Decisions

- **Request Ledger**：顶层 `src/requests/`，能力 module 与 Session 都可导入。负责铸造与识别类型化 Request 身份、绑定 submission/task、解析 task 的 Request 因果、结算等待者，并持有当前前台 Request 及启动恢复时的重建。字符串编码只在 Ledger 内部，格式保持不变，已有 Session 继续可恢复。
- **Ledger 管结算条件，不管结果内容**：Ledger 判定哪些回执属于一个 Request、何时全部结算，持久化最终结果并只发布一次 `request_settled`。把已结算回执组装成 `RequestResult` 是纯函数，Goal 与 Subagent 各自提供读取自身回执（driver 结果、`parentAnswer`、`usage`）的规则；Ledger 不依赖能力的结果格式，`tools/goal` 依赖 Ledger 不成环。
- **Request 结局事实归 Ledger**：当前 Run 服务的 Request 由 Ledger 解析；hook stop 原因与 plan takeover 作为按 Request 记录的结局事实归 Ledger，由结果组装读取。是否停止仍由 Session（之后为 Conversation Runtime）决定。写入在调用方的事务内完成，与 `hook_stopped` notice 原子提交。
- **Session 公开接口不变**：`Session.currentRequestId` 与 `waitForRequest(requestId: string)` 保持不透明字符串，委托 Ledger；Frontend 不改。
- **单一 durable extension 入口**：`rukie.session` 仍是 `beforeRequest`、`onYield`、`afterTools` 等 hook 的唯一入口，按固定顺序调用能力接口；能力不另注册同名 hook。理由见 [ADR-0028](../../docs/adr/0028-single-session-harness-hook-entry.md)：`onYield` 无否决，优先级隐含于 extension 顺序，非 abort 错误被上报后继续执行。
- **Goal**：`tools/goal` 拥有激活校验、driver 任务创建与中止、轮次计数、wrap-up 与激活清理；Session 提供 submit/settle adapter，Request 身份经 Ledger。
- **Conversation Runtime**：`session/conversation/` 下的工厂，root 与 child 各调用一次，输入 Conversation 身份与策略（origin、隐藏工具、stop 标志），产出 permission gate、hook 运行器、jobs、file tracking 与 `beforeTool`/`afterTool`。`forkAt` 与子代理模型选择移入 `tools/subagents/controller`。Session 不再导入 `tools/subagents/state.ts`。
- **Tool Loadout**：原地深化 `session/tools.ts`，吸收 `rebuildTools`、`refreshChildTools`、`childLoadout`、声明 diff、MCP drift 判定与子代理排除名单；`planToolSearchLoadout` 保持为纯函数核心。输出只由 Transcript 与当前输入推导，不新增缓存（ADR-0026）。
- **Interaction**：`interaction` 识别 pending interaction，MCP 只提供 kind 判定，删除 `hasPendingMcpInteraction` 的格式解析。
- **目录整理**：`tools/` 根目录共享运行时支撑移入 `tools/support/` 并同步 `.oxlintrc.json`；`builtin.ts` 是否移动按其组装入口角色确认。`prompt/` 并入 `session/prompt.ts`。

## Testing Decisions

- 新 module 在 `packages/agent/tests/` 下镜像目录直测（`tests/requests/`、`tests/session/conversation/`、`tests/session/tools.test.ts`、`tests/tools/goal/`），使用内存 Storage 或假 harness。
- 每条恢复/结算路径保留一个代表性 e2e 冒烟用例（含崩溃 worker）；等价断言迁到 module 测试后删除对应 e2e 用例。删减前后记录 Bun 耗时。
- 每张票先跑受影响的最小测试集；全部完成后运行一次 `env -u NO_COLOR bun run check`。

## Delivery

分支 `refactor/agent-deepening`，每票一个 Conventional Commit，不 push。

### Aggregate 验证与测试同步修正

第一轮完整 `env -u NO_COLOR bun run check` 实际失败：3181 pass / 1 fail，3182 tests / 294 files，104.80s；唯一失败为 `send_message reuses the child Session with no old jobs, output or reused ids`。修复 child jobs 的逻辑 ownership 后，第二轮完整检查仍实际失败：3183 pass / 1 fail，3184 tests / 294 files，103.84s；前次 jobs 用例通过，唯一新失败为 `a caught-up live identity does not restart and a non-prefix final replacement snaps`。两轮失败均保留，focused 通过不将它们记作 aggregate 通过。

TUI 失败属于重构前已存在的测试同步不足：`app.flush()` 仅完成已接收的终端写入解析，不等待模型 delta 的原生 timer、durable commit/fsync 和 committed event 发布。在当前 `a3d4aa06` 与重构前 `306cd9a7` 上，通过 Storage.commit gate 挂起含 `immediate-tail` 的 partial，可确定性复现原断言：两次 terminal flush 与 16ms 后 commit 尚未完成，屏幕仍只有 `caught up`、活动估计为 3 tokens。释放 gate，并等待活动栏原始输出的 token 估计增加后，tail 在 16ms 前已可见，最终非前缀替换也立即显示。此信号独立于 smooth reveal 的游标；没有等待 tail 本身或扩大超时。

仅在该测试的 model.delta 后增加有界 `app.waitFor`，确认活动栏原始输出估计大于初始 3，再保留原有 16ms、立即 tail 与最终替换断言。没有产品修改或新增测试专用 API；这是完成 final gate 所需的受影响测试消费者修正，无需新增 ADR。TDD evidence：受控 replay 在 baseline/current 上证明原同步为 RED，修正后独立送达屏障与原断言为 GREEN；最小用例重复 20 次，20 pass / 0 fail，2.76s。messages、smooth-reveal、activity-line、activity 四个相关文件共 23 pass / 0 fail，2.92s；`bun run check:dev` 与 `git diff --check` 通过。Spec 保持 claimed，最终 aggregate 与关闭由 integration branch 协调。

### 第三轮 aggregate 与 PID 发布夹具修正

第三轮完整检查在 `8732eaa0` 实际失败：3146 pass / 1 fail，3147 tests / 294 files，105.03s；前两轮回归均通过，唯一失败为 `background-jobs.test.ts` worker 被 SIGKILL，没有 assertion failure。日志未捕获实际 `process.kill` 参数，不能将下述安全复现等同于该次 worker 的已捕获调用。

安全最小复现证明已有夹具缺陷：创建空的 `escaped` PID 文件后，原 `waitFile` 立即返回空字符串，`Number` 转换为 0，正 PID 断言 RED（1.59ms）；复现没有调用 `process.kill`。重构前 `306cd9a7` 的 helper 含同样的按文件名只校验 `pid` 的逻辑。原 escaped 用例随后在 finally 调用 `process.kill(-pid, "SIGKILL")`，若读到空发布阶段则目标为进程组 0，符合 worker 自杀的可能路径；此前 focused 的 exit 137 也出现在同一用例之前，但两次日志均未记录信号调用，保留这一证据边界。

修正仅涉及测试：全部 PID 标记使用 `waitForPidFile` 等待正的 safe integer；通用 readiness 标记仍接受空文件。共享 waiter 用文件事件等待发布，保持 2s failure bound，并在成功或失败时清除 timer、关闭 watcher；缺失目录在创建 watcher 时直接失败。受控文件 read gate 先确认空、0、负数、小数、NaN、越界整数尚未放行，再发布有效 PID；整个回归不发送信号、不使用固定等待。7 项 publication/readiness 回归 GREEN（189ms）；完整 background jobs、subagent jobs、Conversation Runtime 58 pass / 0 fail（9.61s）。共享 waiter 的既有 MCP、network hooks、Session disposal 调用方 59 pass / 0 fail（35.58s），其中 30.19s 保留真实 SDK 30s deadline 合约。escaped descendant 的真实跨进程输出 draining 合约保持原有等待，3.17s。`bun run check:dev` 通过；未重跑 aggregate，spec 保持 claimed，最终集成验收由 integration branch 协调。没有产品 cleanup 算法或架构变化，无需新增 ADR。

### 第四轮 aggregate 与 Jobs panel 空闲同步修正

第四轮完整检查在 `36017bb` 实际失败：3190 pass / 1 fail，3191 tests / 294 files，106.97s；前述回归均通过，唯一失败为 Jobs panel 的 reading position / follow state 用例。失败在提交 `continue follow` 后等待第三次 model call；终端已显示 `continued-stream` 和完成摘要，prompt 保留 `continue follow`。该 aggregate 保留为失败，focused 检查不替代其结果。

`app.isWorking()` 只判断终端中是否绘制 moon spinner；Jobs panel 会隐藏该行，因此 panel 打开时 absence 不代表 Session 或 Frontend 空闲。通过公开 Storage commit gate，在最终 model entry 已提交后挂起 Run summary commit 的完成，可确定性让原用例提前提交输入；此时 `createConversation` 的 active promise 尚未释放，普通 Enter 被拒绝。收到 prompt 保留输入的可观察信号后释放 gate，当前版本与重构前 `306cd9a7` 均出现与第四轮相同的完成画面和缺少第三次 model call，RED 分别 2.54s / 2.87s。该因果链属于既有测试同步缺陷；未修改产品行为。

最小修正使用现有 `committedJobNotifications.pendingTasks() === 0` 确认 panel 打开期间 native driver/generation 的 terminal commits；关闭 panel、返回底部后，再确认可见 spinner 与 `esc interrupt` footer 均消失，见证 Frontend 的 submit admission 已解除，再提交后续输入。受控 gate 验证后者等待时 spinner 确实可见，释放 gate 后原阅读锚点、folding、context notification 和 `followed-stream` 断言全通过，GREEN 621ms。修正后的最小用例重复 20 次：20 pass / 0 fail（7.09s）；Jobs panel、concurrent parity 和 messages 三个相关文件 21 pass / 0 fail（6.95s）。`bun run check:dev` 通过。未添加固定等待、扩大超时或保留诊断 hook；spec 保持 claimed，最终集成验收由 integration branch 协调。无架构决定变化，无需新增 ADR。

### 第五轮 aggregate 与 PID 内容等待修正

第五轮完整检查在 `1ca06631` 实际失败：3190 pass / 1 fail，3191 tests / 294 files，105.56s；此前失败用例均通过，唯一失败为新增 PID publication 回归的 `9007199254740992` case（2003.60ms）。修正前该组 30 次 focused 重复 180 pass / 0 fail（2.32s），因此不将独立重复通过视为已证明没有 event race。

事件驱动 helper 仅在 initial check 和目录 `fs.watch` edge 上读取 PID；shell redirection 打开文件后才完成写入，目录事件可能在内容就绪前到达或被合并。受控 existing read boundary 先返回空内容，观察到初次 sample 后发布正 PID，且不再产生目录事件，原 helper 确定性超时，RED 2007.52ms；不调用真实 kill。该回归证明内容最终就绪而缺少新 event 时 waiter 会漏掉状态；aggregate 没有捕获底层 event 序列，保留该证据边界。

仅 PID 内容 waiter 改为有界状态谓词：每个 I/O turn 重新读取实际文件，仍只接受正的 safe integer，monotonic deadline 保持 2s。`setImmediate` 仅让出 I/O 以观察真实发布状态，不引入固定等待或延长 failure bound；此路径不分配 watcher/timer。通用空 readiness 文件仍使用原 `waitForFile` 的文件事件实现，原函数体恢复，减少共享影响。受控 no-further-event case 与六个无效 PID、空 readiness case 重复 30 次，240 pass / 0 fail（362ms）。完整 background jobs、subagent jobs、Conversation Runtime 59 pass / 0 fail（8.53s）；共享 readiness 调用方的 MCP、network hooks、Session disposal 取消与关闭场景 9 pass / 0 fail（737ms）。首轮 `check:dev` 报 `no-constant-condition`，将循环条件改为 monotonic deadline 谓词后，8 项 PID/readiness focused 用例通过（149ms），最终 `bun run check:dev`、文档与 diff 检查通过。没有产品改动、放宽校验或 atomic rename 绕过真实 shell 发布；spec 保持 claimed，最终集成验收由 integration branch 协调。无架构决定变化，无需新增 ADR。

### 第六轮 aggregate 与八卡 dashboard 夹具同步

第六轮完整检查在 `433af2a` 实际失败：3191 pass / 1 fail，3192 tests / 294 files，105.30s；前述回归均通过，唯一失败为八卡 Subagent dashboard 的键盘选择用例，在 Down 后等待新焦点。原最小用例独立通过；current 120 次双参数 focused 执行 114 pass / 6 fail（47.28s），其中一次捕获同类焦点失败：running-only case 的第 3 个 Down 后选中 Child 3，终端只显示 Child 1/2，没有可见 accent 焦点，其余五次为 mixed case 的 preview 等待。原夹具发送八个 delta 后只等待一个 preview，不能见证所有 native partial commit 与卡片高度都已发布；mixed case 完成顺序还可能令短 viewport 的前三张卡全部 completed，从而没有可见 live preview。

重构前 `306cd9a7` 双参数 60 次 57 pass / 3 fail（25.38s）复现 mixed preview viewport 假设；running-only 120 次通过，没有捕获相同 keyboard-focus 失败。Dashboard 与 keyboard scroll 产品实现未变，但这些证据不将 exact focus failure 自动归为已经在 baseline 复现的产品缺陷。暂时 tall-window 准备与单 child staged probe 均未提供有效 gate（前者引入 resize reading-position 变化），已丢弃；不扩大产品修复范围。

最终修正仅同步本测试的静态 dashboard 准备：test-local public Store wrapper 在实际 commit 返回后计入八个不同 partial document；打开原 100×16 dashboard，确认 preview 与 accent 焦点已绘制，再完成 mixed child Runs，并等到目标状态。七次 Down 的可见焦点、Enter detail、Esc 返回后 selection/scroll geometry 及两次 Up 断言保持不变；live preview 断言移到 mixed completion 之前，避免假定它一定落在后续短 viewport 内。没有新增产品 API、固定等待、扩大 timeout 或改变窗口大小。prepared 双参数 40 次 40 pass / 0 fail（16.02s）；baseline prepared 两例通过（1.219s）。Subagent views、Subagent panel、concurrent parity 三个相关文件 32 pass / 0 fail（11.69s）；其中未修改的 mixed concurrent integration 用例 1.61s，保留实际多 child/Job native commit 成本。`bun run check:dev`、文档、格式与 diff 检查通过。Spec 保持 claimed，最终集成验收由 integration branch 协调；没有架构决定变化，无需新增 ADR。

### 第七轮 aggregate 与通知 Run 后的鼠标坐标同步

第七轮完整检查在 `007e499` 实际失败：3190 pass / 2 fail，3192 tests / 294 files，122.84s；失败为 fullscreen 读位用例与 Jobs panel card-click 用例。此记录对应后者；fullscreen 修正由独立提交 `63a396cf` 提供，其证据来自 aggregate 直接失败，未捕获 focused RED；两个等价 predicate 的作用域调整已独立审阅。Jobs 用例在点击 bash-1 后等 exact job focus 时失败，终端仍为 Transcript，迟到的 background notification Run 已活动；aggregate 保留为失败。

最小用例独立通过（1.16s），原用例 10 次 focused 也通过（8.72s）。公开 Store admission gate 提供确定性证据：挂起首个 idle job 的 `pi.user` 提交，两个 job 已绘制为 settled 时原 `if (app.calls.length === 3)` 仍看到两次调用，跳过 reporter drain。捕获 bash-1 header 的 row 6 后释放 admission，该 Run 将 header 移出 viewport（重新读取 row 为 -1），旧坐标点击无法打开 Jobs，当前与 `306cd9a7` baseline 同类 RED 分别 3.082s / 3.095s。该夹具缺陷在 baseline 可复现；没有产品鼠标或通知逻辑变化。

修正使用已有 test-local notification Store observer，新增计数覆盖实际 committed idle `pi.user` 与 active `rukie.job-notification` 输入。等待两个 job 通知 admission 后，以 native pending task 状态排空至多两个已知 reporter generation；关闭 Jobs，再等可见 Frontend idle，才打开 Transcript 并捕获坐标。bash-2 与 bash-1 的 exact mouse focus、时间、spill file、16 KiB bounded output、dropped 与首个 job 无 promotion 断言均保留。baseline 受控 admission gate GREEN（1.193s）；current 10 次 10 pass / 0 fail（9.46s），Jobs panel 与 concurrent parity 13 pass / 0 fail（6.35s），其余 helper 消费者所在 background jobs 文件 14 pass / 0 fail（7.56s）。`bun run check:dev`、文档与 diff 检查通过。用例保留真实 background promotion 和 400KB 输出/私有文件集成成本，单次 focused 约 0.9–1.2s，没有扩大 timeout 或新增固定等待。

影响检查覆盖全部 notification helper 消费者。其余 pointer capture 用例在已知 model call 持续活动或 job 尚未释放 go 时操作，不处于本例 post-settlement optional-admission 边界；stopped-job signal 用例的可选第三次调用后只进入 cleanup，没有后续坐标或空闲行为断言，未扩大修正。Spec 保持 claimed，最终集成验收由 integration branch 协调；没有架构决定变化，无需新增 ADR。

## Out of Scope

- MCP catalog/OAuth 拆深。
- Request 编码格式变更与数据迁移。
- Session 公开接口与 Frontend 行为变化。

## ADR Coverage

| 决定或修改                            | 归属                                                                                                                                       | 理由                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 能力目录与 Session 组合               | 沿用 [ADR-0011](../../docs/adr/0011-agent-module-ownership.md)                                                                             | 新 module 遵循能力不依赖 Session、Session 组合能力的方向                                   |
| durable 执行与恢复                    | 沿用 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)                                                                           | 不改变执行、持久化与恢复语义，Request 编码保持不变                                         |
| 原生 hook 只由 Session extension 注册 | 新增 [ADR-0028](../../docs/adr/0028-single-session-harness-hook-entry.md)                                                                  | `onYield` 无否决、优先级隐含于注册顺序，能力改为提供接口由 Session 按序调用                |
| Tool Loadout 无缓存                   | 沿用 [ADR-0026](../../docs/adr/0026-protocol-independent-tool-search.md)                                                                   | loadout 仍由 Transcript 推导，装配位置仍在 `session/tools.ts`                              |
| Interaction pending 身份归属          | 沿用 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md) 与 [ADR-0015](../../docs/adr/0015-frontend-interactions-and-plan-mode.md) | Interaction 识别原生阶段与 memo，恢复依据当前配置重新发起，保留取消与缺失回调的安全默认值  |
| 共享 support 与 System Prompt 归属    | 沿用 [ADR-0011](../../docs/adr/0011-agent-module-ownership.md)                                                                             | 支撑与具体协议工厂分开，Prompt 归 Session；不改变 API、持久化或运行行为                    |
| 逻辑 Subagent 的 Jobs 资源生命周期    | 沿用 [ADR-0010](../../docs/adr/0010-own-bash-tool-for-background-jobs.md) 与 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)   | 原生 Conversation 保持独立策略与 tracking；逻辑 child 保留 Jobs 序列，发布回执前清理旧资源 |
| 验收测试的提交、输入与 PID 同步       | 无需 ADR                                                                                                                                   | 仅修正测试等待与准备，不改变产品 API、协议、持久化或清理算法                               |

## Implementation ADR Review

六项实施决定已逐项对照源码：Request Ledger 与能力 receipt reader 保持单向依赖；Goal runtime 提供普通续跑接口；Conversation Runtime 统一 root/child 工具策略；Tool Loadout 从当前 Transcript 和输入规划；Interaction 持有 pending 身份格式；共享支撑与 Prompt 按能力依赖方向归位。原生 hook 仍由 Session 在固定入口注册，没有新增能力原生 hook。Request 编码及 document version 不变，未引入缓存、MCP catalog/OAuth 拆分或 Frontend API 变化。ADR-0011/0024/0026/0028 覆盖实施决定，Interaction 同时沿用 ADR-0015；逻辑 child 的 Jobs ownership 修正沿用 ADR-0010/0024。最终 Standards、Spec 与增量审阅未发现未解决问题，未发现需要替代既有决定的架构变更；覆盖审阅与完整验收完成后关闭 spec。

## Final acceptance

在 integration commit `9ad8b980` 上，第八轮 `env -u NO_COLOR bun run check` 使用隔离 HOME 完整通过：3192 pass / 0 fail，3192 tests / 294 files，105.78s，18146 assertions；format、lint、TypeScript、Knip、scratch/docs 与 ink dependency boundaries 同时通过。前七轮的失败与对应修正保留在上述记录中，不以 focused 通过改写失败结果。完整日志保存为 `/tmp/neant-agent-deepening-final-check-8.log`。

双轴代码审阅发现的 omitted Hook stop reason P1 已修正并复审通过；逻辑 child Jobs ownership 修正及每项测试同步修正均经增量审阅，无未解决 finding。验收覆盖公开 Session 的 root/child、恢复与结算、Goal、工具声明与 Interaction，以及相关终端交互；没有 registry 发布或外部服务上线证据。本次不 push。

01–06 票据全部 resolved；第 06 票与 spec 在同一关闭修改中更新。最终验收后的变更仅为状态与交付记录，通过文档、tracker、格式及 diff 检查，复用上述代码完整验收结果。

## Main integration acceptance

按用户要求合入 main：`b61c6417` 同时保留原 main 的 TUI 消息流／MCP 卡片提交 `0463b6ec` 与本 spec 的交付分支 `486012bc`，无冲突。由于合并后的 TUI 代码不同于第八轮验收，先验证 8 个相关文件的 66 项测试（13.15s），再使用隔离 HOME 验证完整 main。

第一次 main 完整检查实际失败：3198 pass / 2 fail，3200 tests / 295 files，123.29s。失败为 `active continuation history remains exact with future colliding provider timestamps` 与 `card clicks focus exact jobs and expanded promoted details show bounded output, times, spill and dropped data`。前者重放时只等待 composer 即读取卡片坐标；修正等待精确卡片及展开按钮，并从同一就绪帧计算坐标。全量未记录当时坐标，focused 原用例通过，因此提前读取目标仍为推断，未声称确定性复现。相关历史／卡片／mixed Resume 18 pass（4.88s），历史断言保持不变。

Jobs 用例在 focused 第 13 次捕获相同失败：读取的卡片 header 位于零基 row 1，输入派发时该位置已变为 Background Jobs 分组 header，卡片移到 row 2；之前的通知 admission 与 Frontend idle 屏障均已满足。修正通过现有 Transcript search 定位 `launch`，等待唯一搜索结果、已绘制来源与卡片后，再按原坐标点击，保留精确 job 选择、时间、output spill、截断与 dropped 输出断言。15 次 focused 通过（15.42s），Jobs／concurrent parity／Transcript search 22 pass（9.16s）；两个修正均为测试准备，未改产品代码或扩大超时。增量审阅无 finding。

修正提交 `c9a72104`、`b104c325` 合入 main 后，第二次完整 `env -u NO_COLOR bun run check` 在 `b104c325` 通过：3200 pass / 0 fail，3200 tests / 295 files，118.74s，18186 assertions；format、lint、TypeScript、Knip、scratch/docs 与 ink boundaries 同时通过。日志保存在 `/tmp/neant-agent-deepening-main-check.log` 与 `/tmp/neant-agent-deepening-main-check-2.log`。此后只追加本记录，复用该代码状态的完整验收；原 main 提交与重构分支均保留在 main 历史中。未 push。
