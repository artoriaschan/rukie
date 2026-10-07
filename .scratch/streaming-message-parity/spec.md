# dsh-TUI 流式会话消息与交互复刻

Status: resolved

## Problem Statement

Neant 的会话区已经具备部分工具、Background Job 和 Subagent 呈现，但正文、思考、卡片生命周期与阅读交互尚未完整对齐 dsh-TUI。用户在模型流式回复、工具执行和多个后台活动同时更新时，需要一致的消息顺序、清晰的状态与详情入口，也需要在浏览历史和复制文本时保持阅读位置与内容准确性。

仅复刻静态外观不能解决这些问题。固定高度预览、流式 Markdown、平滑显示、折叠时机、不同卡片的点击目标、消息导航、选字及 Session Resume 都属于此次验收范围。

## Solution

以 dsh-TUI 提交 `3c89ea516e4f7d2777efe979200016528722a0b4` 为固定参考，对齐完整会话消息区及其关联详情交互。保留 Neant 品牌、中英本地化、权限、Session 生命周期和既有运行语义。参考未被明确覆盖的行为以该固定版本为准；已确认的差异以本规范为准。

会话展示涵盖用户消息、assistant 正文与 Markdown、思考、工具调用与结果、Background Job、Subagent、问题回答、计划评审、Todo、notice、错误、中断，以及 Neant 实际产生的 compaction 和用量摘要。相关 jobs 面板、Subagent 详情和主屏只读视图、工具文件动作均纳入。

流式更新遵循参考的呈现节奏与状态变化；阅读、展开、选择和复制依据当前真实内容工作。支撑呈现所需的数据允许在 Agent Core 补齐，无法获得的信息省略或明确标为未知。新会话恢复能重建最终事实，不为老会话增加兼容或迁移。

## User Stories

1. As a Neant 用户, I want 用户消息采用参考的气泡、指针、间距和颜色, so that 我能迅速区分自己的输入与模型回复。
2. As a Neant 用户, I want assistant 正文采用参考的标记和 Markdown 排版, so that 回复结构易于阅读。
3. As a Neant 用户, I want Markdown 在逐段到达时保持合理的块布局, so that 未闭合代码块和其他流式结构不会破坏会话阅读。
4. As a Neant 用户, I want 已结束的空 assistant 消息不留下孤立标记, so that 工具前后不会出现无意义的空消息。
5. As a Neant 用户, I want 新的正文以参考的平滑节奏出现, so that 突发 token 不造成不必要的视觉跳动。
6. As a Neant 用户, I want 平滑显示最终追赶全部已到达内容, so that 回复结束时不会漏掉尾部文本。
7. As a Neant 用户, I want 历史内容直接完整呈现, so that 恢复与展开时无需等待重复播放动画。
8. As a Neant 用户, I want 默认思考预览固定显示三行最新内容, so that 长思考不会持续推高消息区。
9. As a Neant 用户, I want 思考预览的末行保留最新 token, so that 我能看到当前思考进展。
10. As a Neant 用户, I want 点击思考切换预览与全文, so that 我能按需要查看细节。
11. As a Neant 用户, I want 思考在参考规定的正文、工具和结束边界收起, so that 已结束的思考不会持续占据空间。
12. As a Neant 用户, I want 思考标题显示可获得的真实耗时或 token 信息, so that 我能理解实际消耗。
13. As a Neant 用户, I want 工具运行、成功、失败和结果未知具有可区分的状态, so that 我不会误判执行结果。
14. As a Neant 用户, I want read、terminal、diff、search 和 generic 等 Tool View 有对应的结构化呈现, so that 工具内容无需从原始 JSON 中辨认。
15. As a Neant 用户, I want 工具标题、分类颜色和内容槽对齐参考, so that 不同工具具有一致且清楚的层级。
16. As a Neant 用户, I want 普通工具输出默认预览三行, so that 大量输出不会淹没会话。
17. As a Neant 用户, I want diff 默认预览八行并能展开, so that 文件变化既简洁又可检查。
18. As a Neant 用户, I want 宽终端自动采用双栏 diff, so that 我能方便比较前后内容。
19. As a Neant 用户, I want 超长展开结果有可浏览的窗口及范围说明, so that 我知道当前显示了哪些内容。
20. As a Neant 用户, I want 完整工具源不可用时得到明确提示, so that 截断内容不会被误称为完整内容。
21. As a Neant 用户, I want 非零退出码和信号保持可见, so that 折叠输出不会隐藏执行问题。
22. As a Neant 用户, I want 工具结果、错误和展开内容直接显示, so that 检查结果不受平滑动画延迟。
23. As a Neant 用户, I want 卡片悬停、折叠按钮与命中区域对齐参考, so that 点击结果可预期。
24. As a Neant 用户, I want 工具路径提供打开、定位和复制绝对路径动作, so that 我能继续检查关联文件。
25. As a Neant 用户, I want 路径动作与卡片折叠互不误触, so that 打开文件不会同时改变卡片状态。
26. As a Neant 用户, I want Background Job 显示真实 ID、状态、命令和耗时, so that 我能识别后台活动。
27. As a Neant 用户, I want Background Job 输出保留最后两行视觉行, so that 我能快速观察最新进展。
28. As a Neant 用户, I want 点击 Background Job 标题打开并聚焦对应任务, so that 我能立即查看详情。
29. As a Neant 用户, I want Background Job 命令独立折叠, so that 查看命令不会替代任务详情入口。
30. As a Neant 用户, I want 相邻 Background Job 组成参考样式的分组, so that 多个活动保持紧凑。
31. As a Neant 用户, I want 至少三个全部结束的 Background Job 默认自动折叠, so that 已结束活动不会长期占用大量空间。
32. As a Neant 用户, I want 折叠任务组仍显示失败和终止计数, so that 我不会忽略需要关注的结果。
33. As a Neant 用户, I want Subagent 运行时显示标题、当前工具和三行输出, so that 我能看到子代理的当前活动。
34. As a Neant 用户, I want Subagent 结束后收起并在失败时保留错误, so that 会话紧凑且问题可见。
35. As a Neant 用户, I want Subagent 卡片打开详情并提供主屏只读视图入口, so that 我能深入阅读而不误发消息。
36. As a Neant 用户, I want Subagent 当前活动、Run Outcome 与委派任务判断保持区分, so that 一次正常结束不会被误认成任务已验收。
37. As a Neant 用户, I want 问题回答、计划评审和 Todo 使用相应呈现, so that 特殊交互不会重复显示为普通工具卡。
38. As a Neant 用户, I want notice、compaction 和用量摘要有清楚的消息层级, so that 辅助信息不会与回复正文混淆。
39. As a Neant 用户, I want 中断或错误后保留已经写入 Transcript 的部分输出并显示原因, so that 我仍能阅读已经生成的内容。
40. As a Neant 用户, I want 实时与恢复后的中断内容一致, so that 重启不会改变我对执行过程的理解。
41. As a Neant 用户, I want 不能确认的工具结果明确显示未知, so that 我不会据此错误地重试有副作用的调用。
42. As a Neant 用户, I want Ctrl+O 控制参考定义的全局详情展开, so that 我能快速检查完整过程。
43. As a Neant 用户, I want Shift+↑ 进入消息选择并用方向键、Enter 和 Esc 操作, so that 我能通过键盘浏览与展开消息。
44. As a Neant 用户, I want Background Job 和 Subagent 保持各自的操作入口, so that 普通消息选择模式不会错误折叠它们。
45. As a Neant 用户, I want 按参考的会话边界导航并看到固定用户提示, so that 长会话中仍能辨认当前阅读位置。
46. As a Neant 用户, I want 向上阅读时暂停跟随并收到新内容提示, so that 流式输出不会夺走阅读位置。
47. As a Neant 用户, I want 回到底部时恢复跟随, so that 我能继续观察最新输出。
48. As a Neant 用户, I want resize、展开和后台更新保持阅读锚点, so that 内容变化不会让我迷失位置。
49. As a Neant 用户, I want 拖动、双击、三击和键盘延长选区遵循参考, so that 我能选择需要的文本。
50. As a Neant 用户, I want 选择完成后自动复制并清除高亮, so that 复制流程与参考一致。
51. As a Neant 用户, I want 流式替换了所选内容时拒绝复制并提示, so that 剪贴板不会包含我没有选中的文本。
52. As a Neant 用户, I want 平台及远程终端剪贴板行为正确, so that 本地与 SSH 使用时复制到合适的位置。
53. As a Neant 用户, I want 普通正文选择不会触发卡片动作, so that 阅读和复制不会造成误操作。
54. As a Neant 用户, I want 多个面板与 Interaction 共存时焦点和按键归属明确, so that 会话导航不会干扰审批或输入历史。
55. As a Neant 用户, I want 新会话恢复后重建消息顺序、最终内容、状态和必要历史信息, so that 保存的事实完整且可信。
56. As a Neant 用户, I want 恢复和切换 Session 时展开、选区、悬停与滚动使用默认状态, so that 上一次界面的临时状态不会污染新的视图。
57. As a Neant 用户, I want Session Resume 不重新运行 Background Job 或自动续跑 Subagent, so that 查看历史不会重复执行动作。
58. As a Neant 用户, I want 小终端保持既有编辑限制、中断与退出能力, so that 新消息交互不会破坏基本可用性。
59. As a Neant 用户, I want 退出恢复终端画面、光标和模式, so that 后续终端使用正常。
60. As a Neant 用户, I want 中文和英文具有对应的界面文案, so that 切换 Locale 后交互仍然清楚。
61. As a Neant 用户, I want 数据不足时省略字段或明确显示未知, so that 进度、耗时和状态不会凭空产生。

## Implementation Decisions

- 固定参考版本，建立逐类消息的视觉、生命周期和交互对照。保留 Neant 品牌与 Locale；参考未授权的行为变化不得借复刻扩展。参考源码复用遵循现有许可及归属要求。
- 沿用 Agent Core、Session、Run、Turn、Transcript、Tool State、Tool View、Interaction、Background Job 和 Subagent 的领域定义。Neant 的 Turn 是一次模型调用及其工具调用，Run 是处理一条 prompt 的全过程；参考同名导航或结束阶段按实际事件边界映射，不重定义这些概念。
- TUI screen 负责 Session 绑定、消息投影、顺序、阅读导航和各面板协调；app components 负责具体消息呈现；design system 与 renderer 提供 Agent Core 无关的 Markdown、布局、选择、命中和动画能力。沿用向下依赖方向，不建立另一条消息执行链。
- 优先改造现有消息、工具卡、jobs 和 Subagent 能力。Agent Core 只补充支撑真实呈现所需的事实、公开查询和生命周期；界面文字、折叠、悬停、选区与动画不进入 Agent Core。
- 用户气泡、assistant 标记、颜色、间距、内容槽、标题截断、悬停背景及点击热区按固定参考对齐。普通正文供选择。2026-10-07 用户后续修正点击要求：工具卡整个矩形（含空白行、行尾空白与缩进）可展开/收起；思考与计划卡整个标题行可切换，正文仍只供选择。拖选不触发折叠，路径和其他独立入口优先处理自己的动作。
- assistant 使用流式 Markdown；在未闭合与最终闭合的内容变化中保持块结构和合理的阅读锚点。空的已结束 assistant 不显示孤立标记。
- 平滑显示默认开启，采用参考约 30fps 的自适应追赶。正文、思考全文、新的运行中工具调用正文参与；历史、工具结果、错误和展开内容完整显示。已有正文游标在 streaming 结束后追赶全部已到达内容，替换内容按参考规则收束；显示节奏不改变原始事件或 Transcript。
- 思考默认 preview，固定三行最新视觉内容，末行按参考保留最新 token。首个正文 token 或工具调用到达时收起 preview；full 展示按参考的完整回复结束边界收起。点击切换预览与全文；全局展开遵循参考。真实耗时与可用 token 信息来自事实，未知不伪造。
- 工具按 Tool View 渲染 read、terminal、diff、search 及 generic 等类型，保持运行、结束、错误、未知结果的区分。普通输出预览三行、diff 八行；自动 diff 布局在 110 列及以上双栏，缩窄后恢复适用布局；保留明确选择布局的既有能力。
- 工具展开采用参考的 400 行窗口及范围披露，可继续浏览超出窗口的内容。完整源缺失、输出截断或缺口必须披露；非零退出码、信号和必要错误说明不被折叠预算隐藏。路径动作、图片入口和卡片展开保留各自的命中边界。
- Background Job 输出固定最后两行视觉行，命令独立折叠；标题打开 jobs 面板并聚焦对应 ID。至少两个相邻任务使用分组轨与摘要，默认至少三个任务全部结束后自动折叠；失败及终止计数始终可见。全局展开与单组操作按参考执行，状态只由实际任务事实决定。
- Subagent 运行时呈现标题、当前工具及三行输出，结束收起，失败保留错误；卡片打开详情，独立入口打开主屏只读视图。保留当前活动、Run Outcome 与任务完成判断的分界，不将正常 Run Outcome 当成委派任务完成。
- 特殊工具路由到问题回答、计划评审、Todo 与 Subagent 等对应呈现，避免重复普通工具卡。notice、compaction、用量摘要及其他辅助消息只消费 Neant 已存在或此次必要补齐的事实，不为复刻辅助卡片引入新执行模式。
- Ctrl+O 全局详情、Shift+↑ 消息选择、方向键移动、Enter 单条展开、Esc 退出、会话边界导航与固定用户提示对齐参考。Background Job 和 Subagent 不作为普通可折叠消息参与选择。按键在输入历史、Interaction 与详情面板之间有明确所有者；参考平台修饰键处理在输入协议可识别的范围内对齐。
- 用户浏览历史时暂停跟随，新内容只更新提示；回底或主动提交按既有规则恢复跟随。流式更新、展开、任务收束和 resize 保持阅读位置。小于 40 列或 12 行沿用暂停编辑与审批的规则，保留中断和退出。
- 自有会话选区替代终端原生选字，支持拖动、双击、三击和键盘延长选择；选择完成后自动复制并清除高亮。复制前核对选中的内容，流式替换导致内容不一致时拒绝复制并提示。选字不触发卡片动作。平台剪贴板、OSC52、tmux 和 SSH 处理遵循参考，SSH 不误写远端本地剪贴板；通过现有 host 与 terminal 边界补齐能力。
- 保留已写入 Transcript 的中断／错误部分正文和思考，追加明确提示；未提交临时显示按最终保存结果收束。实时和 Session Resume 一致，不新增 attempt 提交模型，不把 stopReason 为 error/aborted 直接当成未持久化。这是已确认的参考差异。
- 新会话持久化无法从已保存事实重建的必要历史元数据，优先复用现有 Transcript 表达，不持久化 Tool View 或界面展开、选区、悬停及滚动状态。恢复用默认界面状态重建最终顺序、内容、状态与可获得的耗时等事实。Background Job 不持久化，恢复不重启；Subagent 不自动续跑；结果未知不自动重放。
- 不为老会话设计兼容层、回填或迁移。遵循代码质量约束：Do not preserve backward compatibility unless the user asks for it. 修改内部接口时同步更新全部仓库消费者，移除废弃分支；若确需改变持久化契约，应更新其所属文档而非维持双路径。
- 中英文文案同步更新，Agent Core 保持 Locale 无关；运行参考与公开契约同步更新，领域定义保持唯一归属。自有选区取舍已由 ADR-0006 接受，其他持久化和包职责继续遵循现有 ADR。

## Testing Decisions

- 主要验收入口是现有 TUI `start`／`startWithClock`、可控模型与 headless terminal。通过实际输入、模型回复、Session 事件、屏幕单元格、剪贴板和 host 动作验证用户可观察行为，不检查组件内部 state、私有投影形状或调用次数来代替行为。
- 涉及新增持久化事实或 Session Resume 时，补充现有 `createSession` 与 fake model 的公开入口测试，检查落盘后恢复结果。无需新建产品测试接口；renderer 的复杂边界可在其现有公开终端入口补充低成本验证，完整 wiring 仍由 TUI 场景覆盖。用户已确认采用这些现有入口。
- 复用现有 messages、streaming-burst、tool-expansion、tool-view、tool-reveal、split-diff、file-actions、background-jobs、jobs-panel、subagent-card、subagent-views、question-summary、plan-review、todo-summary、fullscreen 和 session-recovery 测试的驱动方式。参考的 thinking、工具完整性与历史窗口、任务分组、子代理结束和流式 Markdown 验证可用作场景依据，不把另一项目的脚本当成 Neant 的交付命令。
- 用同一组受控内容核对用户消息、正文、思考、工具、Background Job、Subagent 和辅助消息的终端布局、颜色、宽度、间距、标记和排序；覆盖中文、英文、长行、Unicode、空内容及多个消息类型交错。
- 在流式 Markdown 块、思考三行预览、正文／工具触发收起、平滑追赶结束、结果立即显示与历史立即回放等边界，验证最终内容完整且只呈现一次。使用虚拟时钟验证动画前后边界，不通过真实 sleep 估算帧数。
- 复用跨 microtask 的高频流式场景，覆盖底部跟随和向上阅读后的新内容提示；断言没有重复消息、阅读漂移、React 更新深度错误或意外 stderr。下一次 Run 保留前次最终内容。
- 验证工具三行／八行预算、109／110 列 diff 切换、400 行窗口的跨窗口浏览、完整源不可用提示，以及退出码和信号在折叠状态仍可见。大样本由拥有内容窗口的模块低成本验证，TUI 用代表场景验证 wiring。
- 验证各类卡片的鼠标与键盘目标：hover、click、wheel、全局与单条展开、路径动作、job 标题与命令、Subagent 详情与只读视图、消息选择与退出。覆盖工具卡空白区域、思考与计划卡标题行空白的切换；正文拖选与不同入口之间不得误触。
- 验证 Background Job 的前台转后台、运行输出、完成／失败／停止、相邻分组、至少三个已结束任务自动折叠、摘要计数及详情聚焦；覆盖多个任务和多个 Subagent 同时更新的代表场景，保留状态语义。
- 通过现有 host 注入捕获实际剪贴板内容和文件动作；通过 terminal 边界验证需要的 OSC52 与远程策略。覆盖拖动、双击、三击、键盘选区、复制后清除高亮、选择期间流式替换导致拒绝复制、Unicode、跨行及折叠／resize 后内容校验。
- 验证新会话的正常结束、用户中断、provider 错误和未知工具结果：实时内容与保存后恢复一致，提示不重复，不凭空保留未提交的临时尾部，不自动重放。检查历史元数据与默认界面状态，不创建老会话迁移测试。
- 覆盖 resize、阅读锚点、回底、输入历史、Interaction、jobs／Subagent 详情及其他现有面板共存的焦点分配；覆盖小终端边界、中断、关闭与终端恢复。消息区改造不能让既有输入或审批快捷键失效。
- 测试使用隔离项目、homeDir、Locale 与凭据，遵循 Bun 测试运行时。时钟在 finally 恢复，异步工作和清理等待公开完成信号；仅真实子进程或传输时限契约保留必要真实时间，并说明原因。检查超过一秒的用例成本，避免重复昂贵场景。
- 实施期间运行最小受影响测试；代码最终状态通过一次清除 NO_COLOR 的完整 `bun run check`，用于最终审阅与交付。终端颜色测试清除 NO_COLOR。当前规范阶段仅验证文档格式、引用、tracker 状态与 diff，不宣称代码测试通过。

## Out of Scope

- 输入框、状态栏和无关设置页的整体外观重做；范围内保留阅读导航所需的按键协调，以及关联卡片的详情和显示选项。
- 新增 inline 模式，或为了生成 local shell 等参考辅助消息而新增 Neant 没有的执行模式。
- 老会话兼容、数据迁移、历史字段回填，以及未经用户要求的兼容路径。
- 改变权限决策、Interaction 的安全默认值、Plan Mode 与 Permission Mode 的独立性、Background Job 资源归属、Subagent 自动续跑策略或 Run 完成条件。
- 新建 attempt 领域模型、自动重试流式失败、删除已经持久化的中断部分输出，或自动重放未知工具调用。
- 伪造进度、耗时、token、完整源或任务完成；把 Subagent 与 Background Job 合并为一种事实。
- 修改 Headless CLI 的产品呈现，或整体重建现有 harness、renderer 与 Session 存储架构。
- 本次生成规范不包含运行代码实施、提交、合并和 worktree 清理，也不生成尚未请求拆分的实施票。

## Further Notes

用户已确认 Q1–Q8，并通过调用 to-spec 授权将最终共享理解合成为规范。决策过程与参考调查见 [访谈记录](interview.md)。本规范的 `ready-for-agent` 表示需求已可进入实施规划，不表示代码已实现。

领域术语以 [CONTEXT](../../CONTEXT.md) 为准；包职责与 harness 复用沿用既有架构。自有会话选区的取舍见 [ADR-0006](../../docs/adr/0006-fullscreen-tui.md)，Subagent 恢复见 [ADR-0009](../../docs/adr/0009-subagent-resume-outcomes.md)，Background Job 执行路径见 [ADR-0010](../../docs/adr/0010-own-bash-tool-for-background-jobs.md)。这些约束决定哪些参考行为能够直接复刻，哪些需要适配真实事实。

固定参考版本可定位消息列表、流式 Markdown、思考、工具、jobs 和 Subagent 的呈现与投影代码。实施时应从该版本核对行为，形成差异及验收证据；不要跟随参考仓库后续变更而扩大范围。此前调查是源码证据，不是 Neant 行为测试通过的证据。

已接受的差异包括 Neant 品牌与 Locale、领域和生命周期语义、缺失数据处理、小终端规则、已持久化的中断输出保留，以及不考虑老会话。发现这些边界以外的真实冲突时记录并解决，不默默降低复刻范围。

## Comments

- 2026-10-07：按 implement-spec 开始实施，集成分支 `codex/streaming-message-parity`，基线 `b48c548`；按票据依赖调度独立 worktree，最终进行 Standards／Spec 审阅和完整验证。

- 2026-10-07：最终代码 `5dd090458f8d04333236c21bdb68324b74060298` 通过 `rtk proxy caffeinate -is env -u NO_COLOR bun run check`，退出码0；format、lint、types、Knip、scratch 和全量测试通过，2732 pass、0 fail、15330断言、2732 tests /220 files、108.09s。第一次完整检查失败后已定向排查并修复，再次运行有实际代码与验证变化依据。最终 Standards 和 Spec 未解决项均为0；Spec原两项以及交付门槛发现的输入／布局问题已修复并独立复核。详见 [验收记录](acceptance.md)。本次仅收束文档，不改变已验证代码；父规范与最后工单同一提交关闭，12/12 resolved。真实 provider／原生剪贴板／交互终端手工 smoke 未执行，保持限制与历史剪贴板事故披露。
