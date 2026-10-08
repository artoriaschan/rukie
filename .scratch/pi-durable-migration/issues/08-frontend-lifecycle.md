# 08: TUI/Headless 恢复、输出与退出边界

Status: resolved
Blocked by: none

## What to build

让同一版本 Frontend 完整消费新 Session 契约与原生 committed events。实现自动恢复、新 Session picker、普通取消/显式子停止的区分、Headless 本请求收束与终态输出。保持现有终端/附件/locale 分层与视图功能。当前基线为已合并的 dsh ink，公开组件/hooks、immutable RGBA、root 退出与本地 diff 约束遵循 [ADR-0013](../../../docs/adr/0013-adopt-dsh-tui-ink.md) 和 [renderer README](../../../packages/coding-agent/src/ink/README.md)。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [x] TUI 所选新版 Session 打开后自动恢复未结算工作，先呈现一致 snapshot，再流式更新；列表和预览不发模型请求，旧数据不进入 picker。
- [x] TUI 正常退出 close 并保留工作，Esc 普通 abort 默认不跨后台；显式子代理停止作用正确。只有后台工作时仍显示可理解活动，不把父 idle 文案当作全部完成。
- [x] Headless -p 与 --goal 等待请求关联的 child/reporter/后续处理后输出终态并退出；无关任务、历史 child 和长期 anchor 不使命令挂住。
- [x] stream-json 的 Run 边界与最终请求完成可区别，终态不早于相关结果处理；text 返回处理后的最终回答。事件破坏性变更的所有仓库消费和文档例子同步。
- [x] Headless 主动 SIGINT/SIGTERM 保留未完成工作，等待资源关闭，退出结果不伪装为成功；再启动 resume 能继续，连续恢复不重复通知。
- [x] 交互恢复有重新询问、失效旧回复和无 callback 安全默认；父子来源、焦点和排队表现正确。
- [x] TUI 继续经原生组件/hooks 接入；应用拥有图片解码/缩放/裁切，输入 renderer 的 RGBA 不可变。Session close 与 renderer unmount/waitUntilExit/cleanup 分别等待真实完成，不以终端模式已恢复推断存储已关闭；不重新引入旧 renderer shim。
- [x] 受影响的宽度/高度/resize、读取位置、bottom follow、coexisting panels、图像与终端恢复有 terminal assertions；无意的视觉和键盘行为变化已排除。

## Testing Decisions

主要 seam 保持 headless main、CLI 子进程和 TUI start/startWithClock/headless terminal；参考 headless main/cli、mixed-session-resume、exit-resume、permissions 和 streaming-burst。子进程验证真实 signal/重启合同并记录必需成本；timer UI 使用现有 startWithClock/Sinon testClock，保留真实 I/O 和 setImmediate 完成信号；terminal helper 的 Unicode grapheme、颜色及 flush 处理继续复用。小终端和 resize 只覆盖相关状态，退出确认及 handoff deadline 在 deadline 前/到时验证，不因重绘或恢复重置已接纳截止时间。

## Verification

实现完成并经独立 merger 验收；Status 为 resolved。新工作树从精确已 resolved07 `fe7554eb` 开始，frozen install 通过。公开真实 CLI SIGTERM prompt／Goal tracer 首次 RED：进程默认死亡，没有 Interrupted 收束（2 FAIL／678ms）。入口把 SIGTERM 接入现有 host signal／awaited Session.close 路径，保留 SIGINT130；SIGTERM 的 Headless 中断映射为143。实际 Hook shell／child atomic ready-PID tracer 在基线 RED（410ms，进程退出后 shell PID 仍活跃）；修正后两 PID 均已结束、未执行 pending Bash、无 late marker，并可同一 accepted request 冷恢复。没有通过 lease 自动释放或进程死亡推断 graceful teardown。

### Acceptance evidence

| AC  | 当前公开行为与验收                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | resume／mixed-session-resume／resume-picker 验证只读列表与预览零模型请求、历史和模型／标题恢复；03 隔离新版索引排除旧数据。新增 normal-exit pending child 的实际 TUI重开，先看到已提交 parent 和 child partial，再释放 fresh delta；snapshot事实与流式更新各一次。                                                                                                                                                                                       |
| 2   | 新 ordinary chat Esc case 实际 parent signal aborted、child signal未取消，child继续输出与reporter处理；已有 keyboard／mouse selected stop await native terminal。新 Ctrl+D 在父idle／后台child活跃时退出，恢复命令在terminalrestore后输出；重开继续原child。后台-only显示独立活动与child row。                                                                                                                                                           |
| 3   | Headless main、durable-request、真实CLI当前128例验证 prompt／Goal因果请求：parent idle不早出request_settled，相关child/report处理后最终回答；06 late descendant／unrelated held child与07激活重叠验收沿用原生稳定身份。                                                                                                                                                                                                                                  |
| 4   | CLItext／stream-json验证snapshot、nativecommittedchanges、Runresult与request_settled边界及最终text；current consumers审计无旧session_start/reminder_injected/subagents_waiting/conversation_reconciled/session.dispose引用。新增Headless owningREADME定义事件和signal合同，global架构整理仍由09审阅。                                                                                                                                                    |
| 5   | prompt+Goal × SIGINT/SIGTERM实际子进程4例40assertions／1.96s，130／143、Interrupted、sameacceptedinput冷恢复单一结算；Hook实际OS清理覆盖PreToolUse与SessionStart两阶段，2 PASS／26 assertions／1.083s。真实启动与filesystem通知不能用父虚拟钟替代。                                                                                                                                                                                                      |
| 6   | 新40×12挂起Question hostclose→actualTUIreopen重新显示dialog，旧stdin无权批准，新FIFO选择Postgres成为realToolResult；权限／Question／Plan／OAuth／childorigin/FIFO当前90例通过。04原生当前policy／trust／epoch／HTTPstate与Headless安全默认仍为基础。                                                                                                                                                                                                     |
| 7   | TUI原生start、公开renderer runtime／graphics和image-native/source覆盖immutableRGBA、真实worker、unmount/waitUntilExit/error/cleanup。新增exit后await app.exit再冷打开证明storageowner释放，与terminalrawmode恢复分别断言。08无renderer修改；基线对spec92d17ca1存在README、删除sharpadapter、kitty-graphics、sixel-codec、terminal-querier五文件diff，README真实记载未压缩RGBA／≤4096chunks与sharp唯一consumer。09修复来源inventory计数，不宣称diff为空。 |
| 8   | concurrent-parity／streaming-burst／subagent-views/mixedresume检查阅读位置、copy/FIFO/微任务、coexisting panels和smallterminal；images／preview／native图形检查resize/crop/release；新增childcoldresume24→40×12行宽边界。无视觉或键盘实现变化。                                                                                                                                                                                                          |

### Current focused commands

全部命令经 `rtk proxy`、Bun清除NO_COLOR，当前结果exit0：

- Headless main／durable-request／headless/e2e/cli三文件：128 PASS、700 assertions、24.50s。实际CLI进程启动约300ms/例，最长必要集成成本，无扩大timeout。
- TUI streaming-burst／subagent-views／concurrent-parity／mixed-session-resume／resume／resume-picker六文件：26 PASS、365 assertions、6.91s；后加 ordinary Esc单例1 PASS／2 assertions／559ms。
- TUI permissions／questions／plan-review／mcp-auth／subagent-interactions／chatFIFO六文件：90 PASS、334 assertions、13.96s。
- TUI images／image-preview／image-native／image-source四文件：55 PASS、259 assertions、6.39s。
- TUI main／exit-resume／dispatch main三文件：79 PASS、301 assertions、5.81s。新增normalchildexit／Questioncold分别597ms／478ms；初始fixture误用background-aware isWorking和重复virtualclock已修正，没有误称runtime缺陷。
- ink公开runtime：4 PASS、29 assertions、249ms，实际sixelworker／defaultstreamschild／multiRoot及早晚wait完成。

`bun run check:dev` 最终源与文档修改后exit0（format／lint／types／Knip／tracker／46 Markdown／ink boundaries），记录于 `/tmp/pi-durable-08-static-final-current.log`。以上为受影响focused集合，无package／aggregate。历史失败package结果仍保留；09最终统一gate负责全仓结果。

### Initialization cancellation regression

追加真实CLI SessionStart ready-PID tracer先RED：SIGTERM后仍等待Hook，3秒失败界限触发。新增 `SessionOptions.initializationSignal` 只传启动Hook并在返回前检查取消，原生Harness继续使用BACKGROUND_CONTEXT；Headless/TUI宿主把关闭信号用于初始化，打开后继续使用Session.close。SessionStart取消没有已接受prompt，冷打开可提交新prompt；PreToolUse取消保留原接受请求，冷打开继续相同输入。两阶段均断言真实Hook shell／child PID已退出后才接受host完成。

真实TUI启动关闭随后暴露失败初始化的注册读者泄漏：列表调用已关闭Harness，RED307ms。失败清理栈现在先撤销Sessionreader并关闭observation，再释放原有资源。TUI正常exit／Question／child恢复及启动关闭、Agent打开后的信号负向控制共8 PASS、41 assertions、1.109s；负向控制在模型调用已开始后取消初始化信号，实际Run仍提交最终回答。受影响Agent session-dispose／async-hooks／hook-filters／notification-hooks四文件44 PASS、189 assertions、4.40s。此追加来源于真实公开失败，不扩展为运行中的取消授权。

公开renderer graphics补充16 PASS、82 assertions、716ms；其固定来源生产文件未修改。以上检查均为聚焦行为与静态检查，没有运行package／aggregate；09负责统一最终gate。

### ADR coverage

ADR-0024已有nativeclose/abort、恢复与因果结算决定，本票接入可执行信号并验证Frontend，不另设执行循环。ADR-0013／0006保持固定来源原生renderer、immutableRGBA、退出与读取位置；现有局部ink差异不撤销。ADR-0015保持Frontendcallback/FIFO安全默认，04pendingidentity与freshsignal直接复用。SIGINT130沿用，SIGTERM143为可执行入口的常规非成功码，嵌入hostsignal仍130；ownerHeadlessREADME记载。无需新ADR，当前TUIREADME删除不自动续跑Subagent的过时表述；全局文档和来源inventory由09覆盖。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。

2026-10-07 基线刷新：上述 API、时钟和退出义务来自当前 92d17ca1 的 dsh ink 交付结果，本票只适配 durable，不重复 renderer 迁移。

2026-10-08：07 已独立 resolved；08 新工作树 `/tmp/rukie-pi-durable-08`，分支 `codex/pi-durable-08-frontends`，精确基线 `fe7554eb`。沿已确认的 headless main／实际 CLI 子进程／TUI start 与 terminal predicates 公共 seam 执行 tdd；旧准备日志不作为当前验收通过。

2026-10-08 独立 merger 验收：审阅 `ca8a9591` 相对精确07集成 `fe7554eb` 的12文件 diff、全部八项 AC 与当前 focused／static 证据。确认 SIGTERM 沿既有 awaited close 路径释放真实 Hook shell／child 和 Session 资源，Headless130／143 与嵌入 host signal 合同一致；初始化取消只约束 SessionStart／打开边界，原生 Harness 使用 BACKGROUND_CONTEXT，返回后信号不授权 Run abort。失败初始化先撤销已注册 reader／observer，再释放连接、Hook 与存储；普通 Esc、显式 child stop、normal exit/cold snapshot、fresh Question FIFO、小终端与 immutable RGBA 保持各自所有者边界。未改变 ink生产代码，未重跑 package/full。独立合并于 `04639950` 并关闭08、解除09阻塞；集成 tracker/docs、受影响 Markdown format 与 diff 检查通过。09仍负责统一文档审阅、固定来源 inventory 和唯一最终 aggregate gate。
