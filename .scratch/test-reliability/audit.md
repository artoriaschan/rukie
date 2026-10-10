# 测试可靠性审计

日期：2026-10-09。基线：`4febcdd72a9e44a67d7880755cba9e7515321b6b`，包含上一轮尚未提交的六个测试文件修复。目标为 PR #2 的测试可靠性与执行成本，不修改产品行为、发布版本或 CI worker/shard 数量。

## 范围与方法

对现有 308 个 spec 以及新增门禁 spec 做全量语法与风险模式扫描；[inventory.tsv](inventory.tsv) 列出每个文件、层级、风险信号和源码 SHA-256。机械门禁同时扫描 helper，共 354 个测试与 fixture 文件。清单的风险标记是人工定位入口，不代表存在缺陷或完成了逐行人工审阅。

人工核查覆盖固定延时、直接耗时上限、时间合同、全局 env/mock/clock 的恢复、网络 fixture 关闭、共享临时目录、子进程 READY/exit、后台提交与通知、端到端覆盖成本以及上次完整运行中所有超过一秒的用例类别。检查实际 Bun 并行脚本及三个 macOS CI shard；审阅所有机械扫描命中的同步与关闭模式。全量扫描不等于所有断言与所有交错都已穷尽，当前证据不声称百分之百无 flake。

对 2023 个源码 test 定义额外做 AST 用例检查（参数化展开数不同），定位 100 个时间信号、1356 个资源信号及 13 个没有 inline expect 的定义。后者逐项核实为 helper 内断言或终端状态 predicate，不将字符串搜索误判为没有验证。

## 发现与处理

| 问题                                         | 修复与证明                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 固定延时等待输入、hover、审批或退出          | 六个 TUI 文件改为呈现、输入消费、授权回调和 exit；审批等待不使用尚未执行的整批工具副作用                                                                |
| 混合真实 I/O 与自动推进虚拟时间              | 综合并发和历史恢复使用真实 app；真实时间不作为成功条件，后台等待提交与结算                                                                              |
| 历史边界混合鼠标坐标与分页呈现               | 键盘打开指定 child 的 Output，等待页码与内容；公开恢复 snapshot 验证 continuation 唯一性，鼠标保留独立 views 覆盖                                       |
| Session close 与宽 HTML 处理依赖机器速度     | 删除非时间合同的 1 秒上限，保留完成、取消、诊断、文件副作用与后续可用性断言                                                                             |
| 重定向通过 120ms + 120ms 对抗 200ms deadline | 实际服务器第二跳 barrier 到达后触发受控 AbortSignal；证明仅创建一个 deadline 并输出 timeout，不依赖处理速度                                             |
| 交互取消的结果与 200ms 哨兵竞速              | 等待实际 cancellation Promise，框架 timeout 只作为失败上限                                                                                              |
| 网络 fixture 发起关闭后立刻结束              | 18 个文件返回或 await 服务停止 Promise；随后关闭 Session、删除目录或恢复状态                                                                            |
| env 原来缺失时恢复为 undefined 字符串        | PATH 按原始存在性恢复                                                                                                                                   |
| 提示过期和停止确认只探测虚拟经过时间         | MCP notice、Job notice 与 stop confirmation 观察已注册的目标 timeout，在截止前保持内容、截止时触发，再等待呈现结果；renderer 和进程清理仍完成自己的工作 |
| 原位重写 PID marker 被读取到中间字节         | 完成临时文件后 rename 原子发布；观测初始非法值的 barrier 保留，PID 从完整的新文件读取                                                                   |
| 输入框就绪被误当作历史恢复完成               | 同一组 resume 用例分别等待已呈现的历史、工具输出与 context 页脚；移除无时间合同的虚拟时钟                                                               |
| 同类缺陷可再次引入                           | AST 门禁进入 check:dev；负样本证明固定 sleep、timer resolver、focused spec 与跨 spec 导入被拒绝                                                         |

## 保留项与成本

- renderer、动画、Ctrl+C、提示期限和双击窗口属于实际时间行为，保留隔离虚拟时钟；数据格式测试保留固定数值。并发 fixture 不使用固定延时判定完成。
- MCP 子进程的 `delay_ms` 是测试请求声明的服务端传输行为，保留一处带理由的 transport-delay 例外。
- SessionEnd 总共 1.5 秒的真实 Hook 终止预算保留真实经过时间上限及旁注，因为它验证实际多进程关闭的总预算；其他 close 用例只验证结果。父虚拟时钟不能代表子进程退出。
- Detached process group 的 pipe 关闭仍保留 4.5 秒的真实运行预算与进程存活断言；这是关闭行为的集成合同，不能用父虚拟时钟代表 escaped child。
- OAuth 配置固定 callback port 的用例先让 OS 选 ephemeral port 再交给 SDK 重新绑定，仍有极小的重新分配窗口；这是显式非零端口配置合同，不能改成 0 就声称同一覆盖成立。其失败必须报端口争用，不能靠 retry 掩盖。其他 live listener 直接绑定 0。
- publication、registry recovery 和安装用例保留真实 npm 子进程、私有 registry 和已构建包，因其拥有发布恢复与交付入口合同；不将其降成 mock 或提高 retry 数。
- 大样本与保留上限在 owner 测试中验证；综合并发的原样本数保留，因为减小它会改变阅读锚点与选区替换的可观察布局。它约 3 秒完成，15 秒仅是整个组合场景的失败上限。

## 验证

- 第一批 Agent Core 修改：52 pass / 0 fail，4.21 秒；受控重定向不再等待两次 120ms。
- 三类期限场景：45 pass / 0 fail，15.89 秒，保留两个真实子进程及服务生命周期的必要集成成本。
- 门禁：9 pass / 0 fail；拒绝样本与 inert 字符串示例均已验证。
- 网络 fixture 清理与共享 Web Fetch：295 pass / 0 fail，19 个文件，95.39 秒。
- 最终门禁与 SessionEnd focused：17 pass / 0 fail，2.14 秒；check:dev 和 git diff --check 通过。
- 两个独立进程同时运行重定向 fixture：各 14 pass / 0 fail，端口和全局 deadline mock 独立。
- 执行 gate 的 corpus negative control 被正确拒绝，临时违规文件已删除。
- 完整本机检查实际结果：3335 pass / 1 fail，204.51 秒。唯一失败是未发布 PID fixture 将长字符串原位覆盖为短 PID，reader 读到新旧字节拼接；修正为临时文件完成写入后 rename 原子发布。该测试文件的 focused 验证代替完整重跑，其他 full-run 结果保留。
- PID/readiness focused 连续 10 轮通过，完整 CI 在推送后的提交上验收；不得把本机完整检查描述为绿色。

## 首次 PR CI 与修正

`79a4e1fd` 的 CI `37947926647`：构建、源码门禁、shard 1 与 shard 3 通过；shard 2 为 1018 pass / 1 fail。失败为 compaction resume 用例在空输入框出现后立即断言历史，收到 restored index -1。目标历史在稍后的呈现中才完成，通用输入就绪不能证明这个结果。

修正整组六个 resume 用例的等待对象并移除该组虚拟时钟。Focused 六个用例 6 pass / 0 fail，2.08 秒；四个相关文件按四 worker 执行 58 pass / 0 fail，6.01 秒；check:dev 通过。修改不影响共享 fixture 与实现，因此不再运行本机完整检查；推送修正提交后用新的完整 CI 验收，不重跑旧提交求绿。

## 第二次 PR CI 与修正

`123b8aa2` 的 CI `37949526438`：构建与 shard 2 通过；shard 1 为 1156 pass / 1 fail，shard 3 为 1160 pass / 1 fail。MCP 用例在 Tab 后等待操作前已存在的 Transport 字段，断言读到旧焦点；图片草稿与搜索组合用例在搜索计数出现后立即点击，尚未等待搜索高亮呈现。

MCP 改为等待 Body 焦点提示和目标尺寸的布局结果；搜索等待匹配文字的终端反色高亮，再读取卡片点击坐标。保留原来的焦点、菜单及图片恢复断言，不增加 sleep、retry 或 timeout。搜索单例 1 pass / 0 fail，0.68 秒；MCP、图片、搜索和文件操作四个相关文件以四 worker 执行 41 pass / 0 fail，3.44 秒。审查了该 MCP 文件及 TUI e2e 的 resize 等待点；宽度、文本和通用就绪条件是否足以证明完成仍需人工判断，AST 门禁不能证明其因果关系。

上次完整 CI 的两个失败都由测试等待对象引起；本次只修改两个测试文件的结果谓词，不改变共享 helper 或生产代码。相关验证通过后推送新提交，由新代码的 CI 验收，不重跑失败的旧提交。

## 第三次 PR CI 与修正

`735f0276` 的 CI `37951502433`：构建、shard 1（1157 pass）和 shard 2（1019 pass）通过；shard 3 为 1160 pass / 1 fail。上次 MCP 与图片搜索失败均通过。本次失败为 Context 面板遮住 Run 指示后，测试把 `!isWorking()` 当作完成并过早提交后续问题，最终输入仍在 composer，未产生第三次模型调用。

修正该组合场景的顺序：保持回复未完成，完成面板 resize 与关闭，观察聊天中的活动 Run，然后完成回复并等待 Run Summary 与 idle footer 后提交下一条问题。保留全部滚动、审批、输入归属和下一条模型上下文断言。同步规则增加“隐藏指示不等于 idle”；非零 OAuth callback 配置测试及 detached child 的真实预算保留理由也明确记录。

上次完整 CI 仅该结果等待失败；本次不修改共享 helper 或生产代码。四个相关文件按四 worker 验证 46 pass / 0 fail，4.22 秒；check:dev 通过。验证后推送新提交，由新代码的 CI 验收，不重跑旧提交。

## 架构与限制

本次改变测试规则、fixture 与门禁，不改变 Session、Frontend、存储或发布架构，因此无需新 ADR。规则归属 [docs/testing.md](../../docs/testing.md)，根 AGENTS 只保留强制读取入口。参考 DeepSeek Harness 的测试策略与 CI reliability 技能内容，未引入其 Vitest、100% coverage、snapshot profile 或真实模型成本策略。

## 合并 main 后的后台输出与超时清理

2026-10-10，main `9384cd58` 的 CI `38012651950`：静态检查、构建与 shard 2/3 通过；shard 1 为 1155 pass / 2 fail / 1 error。后台输出/流式阅读场景先达到 Bun 5 秒失败界限，迟到的终端等待报错，下一例因虚拟时钟尚未恢复而失败。合并树没有修改该用例及对应实现。本机原单例 1.356 秒通过，整文件 14 pass / 0 fail；没有将本机通过描述成已复现第一次 CI 超时。

受控回归在独立 Bun runner 中令应用测试确实超时：旧 fixture 稳定出现第二例 `A virtual clock is already active`。加入 runner 收尾后，又验证了旧终端 predicate 在清理后继续写已销毁流的 `Unhandled error between tests`；仅在取消时抛 AbortError 仍会成为 Bun 已放弃测试体的未处理错误，不能算修复。

共享 app 在获得目录时登记 `onTestFinished`，与手动清理共享一个幂等 Promise。清理先停止拥有的 predicate，再 abort 并等待应用退出，最后释放终端和目录；初始化失败也释放已获得资源。虚拟时钟在拥有的 app 关闭后恢复，迟到的 finally 不再重复恢复下一例的时钟。Bun 放弃的测试体不会获得一个虚假的 predicate 成功或迟到的错误：其等待停止调度并保持悬置，资源由 runner 收尾独立释放。普通未完成 predicate 的失败界限和错误诊断保留。

新增独立 runner 回归覆盖悬置测试体、正在轮询的终端等待、下一例时钟所有权、迟到 finally、无 between-tests 错误及目录删除；另覆盖 prepare 失败。两个 runner 的真实 1 秒 timeout 是被测 Bun 生命周期合同，父虚拟时钟无法替代；各约 1.2 秒，非一般同步延时。

人工同类审阅覆盖后台任务、Jobs 面板、Job 选择、Subagent 卡片/面板/持久化拒绝、Interaction View、MCP 阅读锚点和 Transcript 搜索十个文件。非时间合同使用真实 app；保留 elapsed 显示、notice 期限、stop confirmation 的隔离虚拟时间断言。其余带时间行为的 activity、图片 notice、timeline hover 与混合恢复场景核查保留理由，不声称所有交错穷尽。

原后台输出用例保留 350 行布局边界、草稿、未读、阅读位置和 resize 断言；350 个等价 delta 改为 10 个代表性 burst，专门 streaming-burst 用例仍覆盖逐 delta/microtask 更新。真实子进程在 FIFO read 上等待父端释放，移除 shell polling；PageUp 已呈现且未读清零后才允许新的输出。移除不属于该合同的自动虚拟时间推进。Focused 用例约 2.02 秒（旧 1.356 秒）：真实 renderer/reveal 和子进程 I/O 不再用加速显示时钟代替，未提高任何原 timeout。首次 CI 超时的完整交错尚未在本机稳定复现，因此以新提交的 CI 验收，不把时钟混用或更新成本假设表述为已证实的产品缺陷。

Focused 分组：后台/Jobs/Subagent Views/生命周期 39 pass（8.70 秒）；Job 选择、Subagent 卡片/拒绝持久化/Agent View 与生命周期 19 pass（2.98 秒）；Interaction/MCP/搜索 31 pass（4.54 秒）；最终生命周期 3 pass（2.56 秒）。整个 TUI 影响范围 1076 pass / 0 fail（130 文件，68.72 秒）；静态检查通过。一次完整 `env -u NO_COLOR bun run check` 通过：3340 pass / 0 fail，310 文件，201.93 秒；原后台场景 2.12 秒、清理回归约 1.23/1.25 秒。本机隔离 HOME 并复用已验收的 0.1.0 包（产品源码未改变）；PR CI 重建当前提交的精确包，远端结果在交付回复中报告。未改产品代码、CI shard/worker、retry 或发布状态，无需新 ADR。

### PR #3 首轮远端验收与 Reporter 顺序修正

`de9b5662` 的 CI `38014876628`：构建通过；shard 2 为 937 pass / 1 fail，Interaction View 的 parent question 用例在结束父回复后等待 `worker done`。后台任务晚于父 Run 结束时，idle Reporter 追加两条输入，输出卡移出 24 行视口；没有出现时钟泄漏的级联错误。shard 1 为 1189 pass / 0 fail（原后台场景 2.65 秒），shard 3 为 1213 pass / 0 fail（三条清理回归通过）；首轮总计 3339 pass / 1 fail，最终 installed 验收因 shard 2 失败而跳过。

本机强制父 Run idle 后才释放子进程，并等待独立 Reporter 模型调用到达，稳定复现与 CI 一致的视口和错误（2.58 秒）。这不是没有输出，而是测试没有控制被断言视口的因果顺序。修复保持父 Run 活动，先验证 `worker done` 与两个通知提交，再完成父回复、等待 native tasks 清零和 idle footer，断言没有额外 Reporter 调用。

同步审阅其他释放 job 后完成回复的场景：40×12 question/notice 用例也改为等待通知提交后完成父回复，并移除“额外调用或瞬时 idle 任一成立”的竞速分支；其他相关用例已有通知提交 barrier，专门 idle Reporter 用例保留真实 Reporter 驱动。修正后四个相关文件 35 pass / 0 fail（8.64 秒），静态检查通过。第二次推送只修改这两个测试的顺序和相关规则/证据，不修改已验收的共享清理 helper 与产品实现；不重复本机完整检查，也不重跑首轮 workflow。

### PR #3 第二轮：回归夹具的准备边界

`f470d2b7` 的 CI `38015672317`：构建与 shard 1/2 通过，Reporter 修正用例 0.40 秒、第二分片 938 pass / 0 fail；shard 3 为 1211 pass / 2 fail / 1 between-tests error。两条新生命周期回归把初始化放在故意的 1 秒失败界限内，CI 超时发生在进入悬置测试体前；后续等待一个从未进入的 finally，另一次未写入 owner marker。前轮曾通过不说明这个设计合理。

夹具准备改放 `beforeEach`，只有已经悬置的测试体触发真实 Bun 超时。独立 process setup probe 证明 hook 的完成不受 body 的短失败界限约束。故意超时的界限缩到 1ms，因为测试体始终未完成，界限不再约束任何成功结果的启动速度；原产品用例和清理界限不增加。外层 runner、输出流和目录也登记幂等 `onTestFinished` 收尾，放弃的父测试体不再执行迟到断言。

进一步增加第三种受控交错：prepare 仍悬置时令 owner 超时，下一例安装时钟后释放旧 prepare。关闭初始化恢复时会产生迟到 AbortError 的问题在 negative control 稳定复现；helper 在已结束的 owner 下释放资源后停止初始化，正常 prepare 错误仍抛出。回归覆盖 ready-body 悬置、终端 predicate、pending prepare 和正常 prepare 失败。四例 focused 4 pass / 0 fail（1.40 秒）；同样的 GitHub Actions reporter 环境 4 pass / 0 fail（1.38 秒），整个 TUI 范围 1077 pass / 0 fail（130 文件，69.00 秒），静态检查通过。

此前完整本机检查为 3340 pass / 0 fail。该轮只增加 test-only app 初始化被放弃时的 catch 分支及 runner 回归，正常 app/Session 路径和其他包不变；以整个 TUI 影响范围、静态检查和新提交的 CI 覆盖，不重复原完整检查求绿。
