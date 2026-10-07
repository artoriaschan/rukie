# 流式会话参考验收

最终验收代码基线为 `5dd090458f8d04333236c21bdb68324b74060298`，集成分支 `codex/streaming-message-parity`；固定参考为 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4`。tickets01–12 与父规范均已 resolved。本文区分所属票据证据、最终完整检查结果及未执行的手工 smoke，并保留首轮失败与修复历史。

## 61 项覆盖矩阵

下表的既有结果来自 [tickets01–12](issues/) 的执行记录，不表示本工单重新运行每项场景。所有测试通过公开 start/startWithClock、createSession、renderer 或所属公开组件边界观察行为；最终集成 gate 已验证完整代码状态，结果见下节。表中的参考简称对应下一节的固定版本路径。

| 故事                                 | 固定参考与 Neant 所有者                       | 可复核的公开覆盖                                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 user bubble                        | U; user-message                               | [messages](../../apps/neant-tui/tests/e2e/messages.test.ts): first-word marker, Unicode style; existing UserMessage/fullscreen cells                                                                                                                                                                                        |
| 2 assistant Markdown/marker          | A; shared Markdown, AssistantMessage          | [messages](../../apps/neant-tui/tests/e2e/messages.test.ts): markers, GFM/math/Mermaid/visible search                                                                                                                                                                                                                       |
| 3 streaming block layout             | A/MessageList; Markdown                       | [messages](../../apps/neant-tui/tests/e2e/messages.test.ts): open→closed fence, pending TeX/code                                                                                                                                                                                                                            |
| 4 empty completed assistant          | A; completed visibility                       | [messages](../../apps/neant-tui/tests/e2e/messages.test.ts) stream/completed/empty and tool handoff                                                                                                                                                                                                                         |
| 5 fresh30fps                         | MessageList smoothReveal; useSmoothText       | [messages](../../apps/neant-tui/tests/e2e/messages.test.ts) burst31/32ms/fresh-one-shot, tool-reveal pending calls                                                                                                                                                                                                          |
| 6 final catch-up                     | same                                          | [messages](../../apps/neant-tui/tests/e2e/messages.test.ts) Run completion chasing final text                                                                                                                                                                                                                               |
| 7 history immediate                  | same                                          | [messages](../../apps/neant-tui/tests/e2e/messages.test.ts) resume + one-shot; tool-reveal resumed rows; thinking saved full. ticket11 [mixed-session-resume](../../apps/neant-tui/tests/e2e/mixed-session-resume.test.ts) actual-store/UI                                                                                  |
| 8 thinking3rows                      | T; ThinkingRow                                | [thinking](../../apps/neant-tui/tests/e2e/thinking.test.ts) holds3/newest Unicode                                                                                                                                                                                                                                           |
| 9 newest last token                  | T; ThinkingRow ticker                         | [thinking](../../apps/neant-tui/tests/e2e/thinking.test.ts) long one-line Unicode newest tail. Spec explicitly corrects reference third-physical-row clipping bug                                                                                                                                                           |
| 10 thinking toggle                   | T; ThinkingRow                                | [thinking](../../apps/neant-tui/tests/e2e/thinking.test.ts) headerclick full/body inert; text-selection thinking decoration drag                                                                                                                                                                                            |
| 11 thinking settle                   | T; conversation Run boundary                  | [thinking](../../apps/neant-tui/tests/e2e/thinking.test.ts) firsttext/tool and multiTurn full/Run-end; historical manual fold regression d2f07f8                                                                                                                                                                            |
| 12 genuine metrics                   | T; native metadata + display                  | Core [thinking](../../apps/neant-tui/tests/e2e/thinking.test.ts) actual persisted phase; UI thinking duration; unknown tokens omitted. ticket11 [mixed-session-resume](../../apps/neant-tui/tests/e2e/mixed-session-resume.test.ts)                                                                                         |
| 13 tool states                       | Tool; ToolCall+actual results                 | tool-view/auxiliary save failures/unknown-tool-outcomes; ticket11 [mixed-session-resume](../../apps/neant-tui/tests/e2e/mixed-session-resume.test.ts) recorded4cases/174assertions; mixed state restore                                                                                                                     |
| 14 structured types                  | Tool; ToolCall presenters                     | tool-view/tool-windows/split-diff/read/search/web; 03 evidence                                                                                                                                                                                                                                                              |
| 15 title/color/slots                 | Tool; presentation                            | tool-view RGB/Unicode/hover and tool-windows;03 reference audit                                                                                                                                                                                                                                                             |
| 16 ordinary3row fold                 | Tool; ToolCall                                | tool-view four-line grace, tool-expansion/read/tool-windows, logical wrapping                                                                                                                                                                                                                                               |
| 17 diff8rows                         | Tool; split-diff                              | split-diff forcedsmall8/expand and04 windows. No new expensive diff sample                                                                                                                                                                                                                                                  |
| 18 auto110columns                    | Tool; SplitDiffView                           | split-diff auto109/110 and tool-windows source offset                                                                                                                                                                                                                                                                       |
| 19 browsable400window                | Tool; window-navigation                       | tool-windows pointer/keyboard allranges; Subagent parity AgentView scoped window. scoped ToolWindow precedes message mode; child detail keys remain scoped. Mixed ownership still                                                                                                                                           |
| 20 unavailable source                | Tool; retained source facts                   | tool-windows resumedtruncatedread/web/search/unifieddiff; ticket11 [mixed-session-resume](../../apps/neant-tui/tests/e2e/mixed-session-resume.test.ts) recorded4cases/174assertions; mixed fact honesty                                                                                                                     |
| 21 exit/signal visible               | Tool; ToolCall status                         | tool-view exitoutsidefold; jobs-panel stoppedreal signal;03 evidence. Keep process escalation existing                                                                                                                                                                                                                      |
| 22 immediate results/errors/full     | Tool; shared reveal contracts                 | tool-reveal complete/deniedsnap/history/resize                                                                                                                                                                                                                                                                              |
| 23 hover/hit boundaries              | Tool/RefA no bodyclick; renderer hover        | tool-expansion card whitespace toggle and source/path drag;04 NoSelect. actual selected-card highlight and source-only copy exclude pinned/rail chrome                                                                                                                                                                      |
| 24 path actions                      | Tool; host/file menu                          | file-actions actualopen/reveal/absolutecopy/failed directories. Avoid real host                                                                                                                                                                                                                                             |
| 25 path vs fold                      | same                                          | file-actions first test; text-selection path drag; ToolCall decorators drag                                                                                                                                                                                                                                                 |
| 26 genuine Job info                  | J; JobCard                                    | background-jobs actualID/timestamps/elapsedfreeze/style; displayprogress absent                                                                                                                                                                                                                                             |
| 27 last2visual rows                  | J; JobCard visual tail                        | background-jobs promotedUnicode40×12/resize                                                                                                                                                                                                                                                                                 |
| 28 job title details                 | J; Chat/jobs panel                            | background-jobs independentcommand/title; jobs-panel exactfocus                                                                                                                                                                                                                                                             |
| 29 independent job command           | J; JobCard                                    | background-jobs commandtogglewithoutdetails and titleopenssameID. CtrlO union and dedicated views retain ownership                                                                                                                                                                                                          |
| 30 adjacent Job group                | J; grouped cards                              | background-jobs pairthreshold/groupisolation/coloredrails                                                                                                                                                                                                                                                                   |
| 31 threefinished fold                | J; group defaults                             | background-jobs threefinished/auto vs pairopen; existing grouped CtrlO/Interaction cases recorded separately. No new3process repeat                                                                                                                                                                                         |
| 32 failure/stop counts               | J; group summary                              | background-jobs mixed stoppedfailed group and narrowcount. No new escalation repeat                                                                                                                                                                                                                                         |
| 33 Subagent running card             | S; SubagentMessage                            | subagent-card3hardclippedrows/currenttool/Unicode/resize; manychildren views                                                                                                                                                                                                                                                |
| 34 finish/failure fold               | S; appearance + actualoutcome                 | subagent-card normal/error/abort; errorreason retained                                                                                                                                                                                                                                                                      |
| 35 detail/AgentView                  | S; Chat/detail+readSubagent                   | subagent-parity independentglyph/readonly/draft/read/resize, subagent-views detailactions                                                                                                                                                                                                                                   |
| 36 Activity/Outcome/task distinction | spec domain +S                                | subagent-card resumestatusidle +actualRunlabel; Core reconciliation allknown/unknown endingcases. ticket11 [mixed-session-resume](../../apps/neant-tui/tests/e2e/mixed-session-resume.test.ts) recorded4cases/174assertions; mixedsavedfacts                                                                                |
| 37 special routes                    | X; questions/plan/Todo                        | question-summary/plan-review/todo-summary actualsafe callbacks +no duplicate genericcard                                                                                                                                                                                                                                    |
| 38 auxiliary hierarchy               | X; SessionNotice/Notice                       | auxiliary-messages nativecompaction quietdivider anderror/abort; usageoff byref                                                                                                                                                                                                                                             |
| 39 committed partial output          | explicit spec difference; Core reconciliation | auxiliary-messages locale/error/abort/nativepartial/savefailure; ticket11 [mixed-session-resume](../../apps/neant-tui/tests/e2e/mixed-session-resume.test.ts) recorded4cases/174assertions; cross-type state. No uncommitted tail retention                                                                                 |
| 40 live/resume interrupt consistency | same                                          | auxiliary-messages live/resume once; Core session-notices/unknownoutcomes. ticket11 [mixed-session-resume](../../apps/neant-tui/tests/e2e/mixed-session-resume.test.ts) recorded4cases/174assertions; own mixed scenario                                                                                                    |
| 41 unknown outcomes                  | Tool; repair facts/presenters                 | core unknown-tool-outcomes and savefailureaux UI. ticket11 [mixed-session-resume](../../apps/neant-tui/tests/e2e/mixed-session-resume.test.ts) recorded4cases/174assertions; finalcanonicalfacts,noautomaticreplay                                                                                                          |
| 42 CtrlO                             | N; global/single expansion                    | tool-expansion,background-jobs activequestion,thinking historical; existing global toggle union, scoped entry/Enter/escape in [message-navigation](../../apps/neant-tui/tests/e2e/message-navigation.test.ts); recorded grouped CtrlO/Interaction checks                                                                    |
| 43 message keyboard mode             | N; stableeligiblecursor                       | [message-navigation](../../apps/neant-tui/tests/e2e/message-navigation.test.ts): stable mode entry/selected Read/Enter/Escape/draft, skips Job/Subagent, active text ShiftUp ownership                                                                                                                                      |
| 44 ownJob/Subagent actions           | N+J/S                                         | dedicatedjob/subagent entrypaths; actual real-Run mixed Read/Job/Subagent mode skips separate cards and preserves own dashboard/detail keys                                                                                                                                                                                 |
| 45 boundary rail/pin                 | N; scrollgeometry/Chat                        | [message-navigation](../../apps/neant-tui/tests/e2e/message-navigation.test.ts) actual input ticks/header, strict chevrons, 59/60 widths, hover119/120ms; `timeline-rail` cheap10k geometry + inactive border RGB                                                                                                           |
| 46 pausedfollow/unread               | N; ScrollBox+Chat                             | streaming-burst parentreading; background-jobs onejob350chunks; jobs-panel/subagent manualread                                                                                                                                                                                                                              |
| 47 returnbottom                      | N; scroll APIs/input                          | streaming-burst CtrlEnd, jobs-panel followstate; [message-navigation](../../apps/neant-tui/tests/e2e/message-navigation.test.ts) same Enter returns bottom and submits retained draft; local slash-panel submission preserves reading source; CtrlEnd and Session clear recorded                                            |
| 48 resize/fold/background anchors    | N; renderer stableanchors                     | tool-expansion/109–110/jobpanel/subagentdetail; renderer `scroll-box` contraction, remounted text and disappearing nested detail preserve source/card; current anchors/deferred seek public                                                                                                                                 |
| 49 drag/multiclick/keyboard          | C; renderer selection                         | text-selection/selection-gestures strict499vs500/peraxisdistance/widewordpath/line/Shift. active gesture ShiftUp extends text and suppresses mode                                                                                                                                                                           |
| 50 autocopy/clear                    | C; host callback                              | text-selection exactclipboard+clearedcells;09 false/throw/sentfeedback                                                                                                                                                                                                                                                      |
| 51 stale copy refusal                | C; paintedselectedbytes                       | text-selection replacementvssafeappend/gestureShiftstalerefusal                                                                                                                                                                                                                                                             |
| 52 local/remote clipboard            | C/OSC; host                                   | host/write-clipboard fakePATH platform/Linuxcache/SSH/tmux/Kitty/screen/deadline/dispose. No reexecute realclipboard                                                                                                                                                                                                        |
| 53 selecting no actions              | C; hovercapture suppression                   | path/result/thinkingdrag and wheel/Interaction invalidation. source-only copy excludes timeline/pinned chrome and active Shift precedence                                                                                                                                                                                   |
| 54 panel/Interaction ownership       | N/X; Chat precedence                          | questions/plan/fullscreen/MCPjobs coexist, selectiongesture questioncapturesinput. permission arrows/Enter, own views, scoped tools/search/key guards. Parent Interaction arrival while AgentView stays open remains                                                                                                        |
| 55 savedorder/finalfacts             | spec storage; Session+conversation            | messages/thinking/tools/specialsummaries/Subagentreadonlysnapshot; ticket11 [mixed-session-resume](../../apps/neant-tui/tests/e2e/mixed-session-resume.test.ts) recorded4cases/174assertions; integratedcanonicalmixedrestore                                                                                               |
| 56 transient reset                   | N/C; Session-bound UI                         | text-selection latecopynewSession and gestures disabled regions; clear/new Session defaults and resume virtual-clock fixture; ticket11 [mixed-session-resume](../../apps/neant-tui/tests/e2e/mixed-session-resume.test.ts) recorded4cases/174assertions; actualresume defaults                                              |
| 57 no background/subagent replay     | spec domain; Core                             | background-jobs historicalIDnotnewjob, subagent-observation readonlyresume andunknownoutcomes childnotreplayed. ticket11 [mixed-session-resume](../../apps/neant-tui/tests/e2e/mixed-session-resume.test.ts) recorded4cases/174assertions; mixedrestoration                                                                 |
| 58 smallterminal baseline            | spec accepted threshold40×12; Chat            | fullscreen editingrestricted+draftrestore; jobs/promoted40×12/Interaction; AgentView40×12. en/zh message selection clears on small resize, restored draft/history; ticket11 [mixed-session-resume](../../apps/neant-tui/tests/e2e/mixed-session-resume.test.ts) recorded4cases/174assertions; final restored mixed controls |
| 59 restoreterminal                   | renderer lifetime                             | fullscreen alternate/cursor/mode, fatalpaintIO; hostdisposed no lateOSC                                                                                                                                                                                                                                                     |
| 60 zh/en                             | Locale policy; i18n                           | eachowningticket pairedcases/cell/style                                                                                                                                                                                                                                                                                     |
| 61 missing facts honest              | spec overridesplaceholderdefaults             | omitthinkingtokens, optionalSubagentmetrics, unknownToolOutcome, truncatedsource/sentOSC; ticket11 [mixed-session-resume](../../apps/neant-tui/tests/e2e/mixed-session-resume.test.ts) recorded4cases/174assertions; finalmixedtruthfulness                                                                                 |

## 固定参考核对范围

| 类型  | 固定版本路径与核对规则                                                                                                                                                                                       | Neant 证据归属                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| U / A | `src/components/messages/UserPromptMessage.tsx`、`AssistantTextMessage.tsx`、`MessageList.tsx`、StreamingMarkdown / terminal Markdown：金色加粗用户指针、普通正文标记、块布局、空正文及约30fps自适应追赶     | [01](issues/01-messages-and-streaming-markdown.md)、[TUI README](../../apps/neant-tui/README.md)、[renderer README](../../packages/tui/README.md) |
| T     | `AssistantThinkingMessage.tsx`、MessageList reasoning：三行视觉 ticker、最新 token、preview/full 与真实结束边界、共享 reveal                                                                                 | [02](issues/02-thinking-preview-and-lifecycle.md)                                                                                                 |
| Tool  | `AssistantToolUseMessage.tsx`、MessageList tool/diff：标题、分类颜色、状态独立于正文预算；普通3行/diff8行及一行宽限、400行窗口、109/110 切换、hover/path/drag 热区                                           | [03](issues/03-structured-tool-cards-and-actions.md)、[04](issues/04-long-tool-output-and-diff.md)                                                |
| J / S | `src/components/Chat/JobCard.tsx`、`JobGroupHeader.tsx`、`SubagentMessage.tsx`、`JobsPanel.tsx`：两行 Job 尾部、相邻分组、至少三个全部结束收起、子代理三行硬裁剪、独立详情与 glyph 入口                      | [05](issues/05-background-job-cards-groups-and-detail.md)、[06](issues/06-subagent-cards-and-readonly-detail.md)                                  |
| X     | MessageList auxiliary rows、Chat interrupt routing：专用问题/计划/Todo、辅助层级、默认关闭用量行、Interaction 在 Agent View 前接管并恢复原场景                                                               | [07](issues/07-interaction-and-auxiliary-messages.md)、[11](issues/11-interruption-and-session-resume-consistency.md)                             |
| N     | `Chat.tsx`、`TimelineRail.tsx`、`ink/timeline-rail.ts`、`PinnedTurnHeader.tsx`：消息光标、全局/单卡 union、实际输入/Run 锚点、严格可达上下边界、两列 rail、60列与120ms边界、阅读时固定提示                   | [10](issues/10-message-navigation-and-reading-position.md)                                                                                        |
| C     | `src/ink/selection.ts`、`ink.tsx`、App press/release、`use-copy-on-select.ts`、`src/ink/termio/osc.ts`：多击与修饰键、Unicode/软换行、held wheel 两端平移并捕获实际离屏文字、释放复制校验、平台/SSH/tmux/OSC | [08](issues/08-drag-selection-and-copy.md)、[09](issues/09-extended-selection-and-terminal-clipboard.md)                                          |

视觉证据包含 owning tests 的 RGB、粗体、宽度、位置、槽预算和源码文本断言，以及真实点击、拖选、键盘、滚轮、resize 和 Resume。截图不能代替这些交互断言。ticket12 混合屏幕还独立核对固定参考 `#D8B270` 的运行状态色，并观察多个实际卡片同时更新。

## 规范确认的差异

- 保留 Neant 品牌及 en/zh 文案。Agent Core 的 Session、Run、Turn、Transcript、Tool State、Background Job 与 Subagent 语义不改成参考的同名概念；导航映射实际输入或 Run 边界。权限、Plan Mode、Interaction 安全默认值及资源归属保持已有规则。
- 缺失耗时、token、模型或历史事实时省略或标未知；不使用参考占位默认值推断执行成功或任务验收。Subagent 的 Activity、Run Outcome 和父代理对委派任务的判断分别保留。输出范围只描述实际保留源，缺口/截断/patch-only 必须披露。
- 小于40列或12行暂停编辑与审批，保留中断/退出；不引入参考 local shell 等 Neant 不具备的执行模式。
- 已经写入 Transcript 的 error/aborted 部分正文和思考保留，未提交临时尾部按最终保存事实收束；没有 attempt 模型、旧会话迁移、自动重试或未知工具重放。Background Job 不恢复执行，子代理只读查看不自动续跑。
- 父规范明确修正参考边界：思考末行必须保留最新 token；失败工具不能沿用无条件成功 glyph；`sent` OSC 请求不宣称剪贴板已成功；拖选不能触发卡片动作；空白热区限制已按 2026-10-07 后续用户要求修正为工具卡整卡、思考与计划整行标题可点击。400 行后的继续浏览是规范要求的扩展，固定参考没有对应后续窗口入口。以上是规范驱动的差异，不宣称逐字相同。

## 新组合场景与成本

[concurrent-parity.test.ts](../../apps/neant-tui/tests/e2e/concurrent-parity.test.ts) 使用一个公开 startWithClock 生命周期、隔离 cwd/home、受控模型和 fake host。父 Session 先留下中文/Unicode 长历史，再执行实际 read、两项带文件 gate 的 bash Background Job 和两个实际子 Session。父正文与双方子输出跨两次 Promise microtask 边界交错64次；一方实际 read 失败并结束，另一方继续流式输出。场景先跟随，再定位旧输入、暂停阅读并复制 Unicode 源，后台更新不移动原正文；40×12 round trip 恢复锚点；原生最终消息替换所选正文后拒绝复制；实际父问题临时接管 Agent View 并返回仍存活的子输出；Job 成功/失败与 exit7详情、父草稿、下一 Run 的一次 canonical 内容和终端退出均由公开行为核对。没有重复既有350chunk stress、400行大样本、恢复链或停止升级测试。

定时显示与重绘使用虚拟时钟；终端谓词、实际工具结果和 main 完成信号驱动同步及清理。真实 bash 只在测试隔离目录等待 step/go 文件，每10ms轮询是子进程契约，虚拟时钟不控制它；正常完成与 finally 都释放 gate。没有任意固定测试 sleep，没有未隔离原生剪贴板或文件 host 动作。

本例初次完整通过27断言、1.25s，已检查超过1s成本：真实两进程、三个 Session 初始化/持久化和终端多类型绘制是所需集成成本。临时 CPU 采样显示准备阶段占主要成本；Bun 虚拟时钟替换 Date/高精度计时，不能用这些值伪报墙钟阶段耗时。大屏缩为80×60保留所有代表卡片，并继续复用已有350chunk与独立大样本。最终 focused/static 结果在下节填写。

## 验证状态与限制

- 已运行：`rtk env -u NO_COLOR bun test apps/neant-tui/tests/e2e/concurrent-parity.test.ts`：1 pass、27断言、1.27s（整条命令1.48s）；`rtk bun run check:dev` 的 format/lint/types/Knip/scratch 通过。61矩阵行与全部相对 Markdown 引用已检查；详情见 [ticket12](issues/12-concurrent-streaming-and-parity-acceptance.md)。
- 前置证据：ticket11 真实保存/恢复混合链4用例174断言1.53s；ticket10 集成导航21用例60断言2.67s；Interaction 接管修复拥有6用例42断言及其集成复核。更完整的各类证据在所属工单，不重复宣称为本票新执行结果。
- 最终完整检查：代码 `5dd090458f8d04333236c21bdb68324b74060298` 执行 `rtk proxy caffeinate -is env -u NO_COLOR bun run check`，退出码0；format/lint/types/Knip/scratch 通过，2732 pass、0 fail、15330断言、2732 tests /220 files、108.09s。首轮失败后修复代码并通过 focused／独立审阅才重新执行；最终 Standards／Spec 未解决项均为0。
- 手工 smoke 未执行，真实 provider、OS/native 剪贴板和真实交互终端可用性不由 fake-model/headless 场景证明。平台/SSH/tmux/OSC 的自动化证据使用隔离 helper 与 terminal transport。
- 已发生的验证事故：ticket09 初始红 fixture 曾误写真实 macOS 剪贴板为 `hi`，没有读取或恢复原剪贴板；最终相关 fixture 使用隔离 host。本票没有原生剪贴板写入。

## 最终审阅修复

最终 Standards 审阅无发现；Spec 审阅以公开 RED 确认两项缺口：实际子 Session 保存失败后打开的 Agent View 保留未提交尾部，以及 Job 边框／分组轨进入复制文字。修复读取子 Session 已提交分支替换正文及工具状态，保持已保存部分和 Unknown Tool Outcome；后续子 Run、父会话重建和关闭使旧请求失效。Job 仅排除装饰边框和分组轨，输出符号、状态及 Unicode 原文保留。

[subagent-save-reconciliation.test.ts](../../apps/neant-tui/tests/e2e/subagent-save-reconciliation.test.ts) 经公开 startWithClock、真实 JSONL store 与实际子 Session 验证 assistant/toolResult 两类保存失败、已提交思考和 read、已发生的 write 副作用与未知结果、实时和冷恢复相同以及同一子 Session 的新 Run。[job-selection.test.ts](../../apps/neant-tui/tests/e2e/job-selection.test.ts) 通过隔离 fake host 验证单卡及分组卡的 Unicode 命令／输出复制，不含边框和轨道。公开 RED 分别267ms、236ms，未访问原生剪贴板。最终 focused 命令 `rtk proxy env -u NO_COLOR bun test apps/neant-tui/tests/e2e/subagent-save-reconciliation.test.ts apps/neant-tui/tests/e2e/job-selection.test.ts apps/neant-tui/tests/e2e/subagent-history-boundary.test.ts apps/neant-tui/tests/e2e/mixed-session-resume.test.ts apps/neant-tui/tests/e2e/background-jobs.test.ts apps/neant-tui/tests/e2e/text-selection.test.ts`：35 pass、367断言、13.58s；新增4用例237/184/260/242ms，均小于1s。既有 Background Job 进程启动／真实停止升级／更新resize成本为2.17/3.28/2.49s，沿用所属工单的必要进程契约。本次 `rtk proxy bun run check:dev` 和 `git diff --check` 通过。独立集成复核发现瞬时 `failed` 可在绘制前被已提交的 `Run ended with error` 替换，fixture 改为等待持久 Run Outcome 和尾部移除；未知工具结果不改写为失败。该修复阶段未运行完整 gate；最终结果见上述验证状态。

## 完整 gate 失败后的修复证据

主代理第一次完整 gate：2681 pass、46 fail、15189断言、2727 tests /220 files、121.05s，退出码1；这不是完成证据。按所属模块逐项 focused 排查，确认三个实际问题：阅读时 Enter 被先行消费；flex-shrunk 祖先的 ScrollBox 使用过时高度导致提问选项被欢迎图覆盖；固定输入提示未计入40×12布局使审批 Esc 行溢出。公开 RED 后分别修复输入所有权、祖先内容边界（padding/border优先级及nested）与固定提示行预算。无 vendored Yoga 修改或新生产测试接口。菜单打开仍保留阅读源，普通草稿同一次 Enter 回底并提交，End 只回底，与固定参考 Return 传播一致。

其余失败迁移至已批准呈现：Markdown正文保留原始模型上下文；思考显示最新三行；通用工具为accent、Goal标题空格分隔；MCP/compaction为安静 divider 且私有摘要保持隐藏。恢复、回退、modal返回和最后正文使用最终绘制谓词；Jobs被父问题临时接管后恢复同一任务。Run store与失败恢复读取的两个句柄分别验证关闭顺序，未删掉排队写入必须先完成的义务。

最终 focused 两批：所属六文件94 pass /576断言 /17.84s；迁移及Agent13文件144 pass /1746断言 /18.52s。回退受影响四用例4 pass /39断言 /1.67s；新增40×12阅读斜杠菜单用例通过。TPS精确500样本淘汰通过消费者公开订阅边界验证，保留一次真实Session Run接线；1005断言，原>5000ms超时降至33.64ms。Jobs流式modal由真实计时1263ms降至虚拟计时271ms。Jobs真实两进程文件轮询／输出／持久化场景仍1.69s，是子进程时钟与IO的必要契约；未放宽超时或增加固定sleep。新增布局4用例各<2ms，交互welcome无残留用例131ms。该修复阶段保持claimed；之后独立 Standards／Spec 复核均无未解决项，最终完整检查通过并关闭 tracker，见上述验证状态。

## 可复制的本地 smoke

先在仓库根目录运行自动化入口；focused 命令仅验证组合场景，完整 gate 已由主代理执行；下面是操作者之后重新验证的入口。

```sh
rtk proxy env -u NO_COLOR bun test apps/neant-tui/tests/e2e/concurrent-parity.test.ts
rtk proxy env -u NO_COLOR bun run check
```

交互 smoke 需要已配置可用 provider 的真实终端，环境 Locale 适用于未被 settings 固定的 Locale；下面仅创建临时项目，沿用操作者的 provider 配置，不写入仓库或用户 settings。

```sh
TASK_REPO=$(git rev-parse --show-toplevel)
TASK_PROJECT=$(mktemp -d "${TMPDIR:-/tmp}/neant-parity-smoke.XXXXXX")
printf 'one\ntwo\nthree\nfour\nfive\n' > "$TASK_PROJECT/read.txt"
seq 1 805 > "$TASK_PROJECT/long.txt"
cd "$TASK_PROJECT"
env -u NO_COLOR LANG=en_US.UTF-8 bun "$TASK_REPO/apps/neant-tui/src/main.tsx" --permission-mode ask --thinking high "先阅读read.txt，再按需询问我；用Markdown、代码块及中文Unicode输出说明。"
```

1. 检查用户指针、正文 Markdown、思考三行与结束收起；让模型 read long.txt，展开并浏览400行后的保留源，观察范围与不可用源披露。让模型对临时文件做20行 patch，终端宽度109↔110检查双栏切换和源位置；审批只使用自己愿意批准的临时项目动作。
2. 在会话中要求两项 `run_in_background:true` bash（例如各30秒、每0.2秒输出一次）与两个后台子代理。观察 Job 两行尾部和子代理三行；点击 Job 标题、命令及子代理详情/⤢，回来确认草稿及阅读源。至少三个已结束 Job 的自动组折叠由既有自动化精确覆盖，可另行手动启动第三项观察。
3. Wheel/PageUp 阅读旧输入，检查固定提示与新内容提示；Ctrl+O、Shift+↑/方向/Enter/Esc，40×12及更小窗口，然后 Ctrl+End 回底。消息选择跳过 Job/Subagent，详情与 Interaction 接管按键。子代理 Agent View 打开期间让父问题到达，回答后应返回同一只读场景。
4. 拖选 Unicode、双击/三击与 active Shift 扩展，确认复制内容不含 marker、框线、rail 或固定提示；选中正文期间新内容只在范围外增长仍可复制，实际替换所选源时应拒绝复制。观察 native 成功、失败或 OSC 请求已发送的准确反馈。平台剪贴板步骤由操作者主动执行。
5. 中断父 Run，恢复刚创建的 Session，核对已提交部分内容、一次原因、未知结果与默认临时状态；查看历史不自动重启 Job/子代理。退出后确认原终端画面、光标、raw/mouse/alternate-screen 模式恢复。换 `LANG=zh_CN.UTF-8` 重启同一命令核对对应文案。

记录实际观察结果与 provider/终端环境；未运行的步骤保持未运行，不从源码推断通过。Session 保存/恢复语义由 [Agent Core README](../../packages/agent/README.md)、交互规则由 [TUI README](../../apps/neant-tui/README.md) 维护。

- Final allocation consistency recheck: message-navigation/Todo/question/MCP79 pass,508 assertions,14.53s; `rtk proxy bun run check:dev` and `rtk proxy git diff --check` passed. Integration baseline matches `bb01805099b2cb55c6d8fa42e29c05fa6fdae804`. No aggregate check or native clipboard action was performed in this worktree.

## 最终交付

2026-10-07：最终代码 `5dd090458f8d04333236c21bdb68324b74060298` 的完整检查通过（2732 pass、0 fail、15330断言、2732 tests /220 files、108.09s，退出码0），Standards／Spec 剩余问题均为0；父规范与12张工单全部 resolved。本次收束提交仅修改验收和 tracker 文档，保留已验证代码状态。18个实现 worktree 已检查干净且均为集成分支祖先，按 implement-spec 清理；集成工作区和 main 保留。手工 smoke 与原生平台验证的限制，以及 ticket09 历史剪贴板事故，保持如上披露。

## 2026-10-07 卡片空白点击修正

用户反馈点击非文字部分无法展开/收起，明确替代此前的空白热区限制。工具卡由外层矩形提供默认切换动作，标题、普通输出、Markdown 与 split diff 的空白均可命中；子路径和窗口入口仍优先命中各自动作，拖选继续取消卡片点击。思考与计划标题取消文字宽度限制，正文保留原有选择行为。

回归复现：修正前工具卡标题、web 正文、思考标题、计划标题空白点击均失败；修正后 4 项通过。相关 7 个文件共 56 项测试通过，覆盖选择、路径动作、窗口、Tooltip、思考生命周期与计划交互；空白行、40 列 resize 与卡片外点击回归通过。最终 `env -u NO_COLOR bun run check` 通过：2732 pass / 0 fail，15333 assertions，220 files，105.62s。

## 2026-10-07 消息卡片间距

会话列表中的相邻消息卡片之间增加一行空白；已完成历史、实时思考、正文与工具使用同一个带间距的纵向容器，卡片内部布局保留。`message-spacing.test.ts` 验证实时、完成与 40 列 resize 后的间隔；恢复快照按新行距更新，历史内容检查先滚动到对应视口，必要的完整内容测试分配足够窗口高度。

验证：最初 TUI 检查暴露 6 项旧行号或视口容量断言，首次完整检查另暴露 1 项两轮对话的窗口容量断言，均经针对性复现与修正；启动与恢复的 50 项测试通过。最终 `env -u NO_COLOR bun run check` 通过：2733 pass / 0 fail，15373 assertions，221 files，107.75s。

## 2026-10-07 长标题耗时布局

工具标题按可见宽度为状态标记、耗时与折叠箭头预留固定列；非悬停时箭头槽位保留空白，标题使用剩余宽度，路径点击范围避开耗时和箭头。长 read 路径与 bash 命令的 80/40 列回归覆盖悬停进入、离开及 resize，核对耗时始终可见且列位置稳定。超长 emoji 后缀允许自然换行，验证展开后内容完整。

验证：`tool-header-layout`、`tool-tooltip`、`tool-expansion` 与 `text-selection` 共 25 pass / 0 fail，123 assertions，3.68s；`bun run check:dev` 通过。按用户本次要求未运行全量测试。

## 2026-10-07 Markdown 代码框

截图反馈的代码块只有顶边与左边，是手绘开放框的实现结果。代码块改用现有原生单线边框，右边与底边随内容布局完整绘制；语言标签限定在顶边内，正文按实际容器宽度换行，语法高亮与原文复制保留。移除按终端全局列数预折行及逐行切片路径。

验证：助手代码框在未闭合流式输入、完成与 80→40 列 resize 后的四边；24 列容器中的长语言标签、Unicode 与正文换行；复制不带边框；思考 Markdown 与助手标记。相关 5 个文件共 30 pass / 0 fail，139 assertions，2.37s；`bun run check:dev` 通过。按用户要求未运行全量测试。

## 2026-10-07 满宽卡片折叠箭头

时间轴占用右侧两列后，工具标题行仍使用终端全局宽度，导致箭头被裁掉。标题行改为由实际父容器约束宽度，标题收缩时保留耗时和箭头固定槽位。旧实现的时间轴端到端用例复现箭头不可见；修正后在 80/60 列带时间轴的窗口中验证箭头可见、点击展开/收起，以及 78/38 列容器的 Unicode 标题和耗时位置。

验证：标题布局、Tooltip、展开与原文选择共 5 个文件，28 pass / 0 fail，136 assertions，3.36s；`bun run check:dev` 通过。按用户要求未运行全量测试。

## 2026-10-07 Turn 指示器出现后的代码框

代码框在首轮已经绘制，第二轮输入使右侧 Turn 时间轴出现后，Markdown 根容器未参与横向收缩，保留旧宽度，导致代码框右边被裁掉。Markdown 根容器改为随实际父容器伸缩；原有代码框会在时间轴出现及 resize 时重新适配。修正前新增端到端用例的右上角断言失败；修正后在 60/80/81/120/121/240/241/256 列窗口验证右上角、右下角和每行右边框（Unicode 行按终端单元格检查）。

验证：代码框、助手 Markdown、思考、web Markdown 与原文选择共 6 个文件，33 pass / 0 fail，245 assertions，3.76s；`bun run check:dev` 通过。按用户要求未运行全量测试。

## 2026-10-07 后续全量验证

用户要求运行全量测试并修复失败。首次 `env -u NO_COLOR bun run test`：2740 pass / 1 fail，225 files，106.07s。唯一失败是旧 edit 记录恢复用例要求 80 列标题容纳完整 JSON；耗时与折叠箭头固定槽位导致标题正常截断，原始结果仍正常显示。将该回退语义用例设置为 100 列，保留既有窄窗口标题、Tooltip 和箭头行为覆盖。相关 3 个文件 9 pass / 0 fail，57 assertions，1.20s。

最终 `env -u NO_COLOR bun run check` 退出码 0：静态检查全部通过，2741 pass / 0 fail，15535 assertions，225 files，全量测试 99.91s。测试代码验证后未再修改；本节仅记录实际结果。

## 2026-10-07 输入框上方留白

会话内容容器增加一行底部内边距，底部跟随时末条消息与输入框之间保留两行空白。留白属于滚动内容，不额外缩小视口；消息之间原有一行间隔保留。回归先复现原有一行间隔，再验证 80×24 与 40×12 的两行留白。

验证：消息间距、导航、展开与 Markdown 代码框共 4 个文件，18 pass / 0 fail，197 assertions，4.42s；`bun run check:dev` 通过。覆盖底部跟随、历史阅读位置及小窗口，未运行全量测试。

## 2026-10-07 Resume 上下文预览

恢复消息后，conversation 初始化读取 Session 的当前 Context Usage 快照，首次输入前即可重建底部占用预览。Agent Core 的 `contextUsage()` 复用现有计算路径，恢复时重算分段和总量，新回复后保留当前 provider 输入计数；不发起模型请求、不累加历史用量。公开接口义务记录在 Agent Core README，保持原有上下文语义，无需新增 ADR。

验证：修正前 resume 的底部无 `/128k`，修正后首次输入前和 40×12 resize 后均可见且模型调用数为零。上下文、分类报告、恢复、恢复面板和 conversation 共 6 个文件，35 pass / 0 fail，1329 assertions，5.79s；`bun run check:dev` 通过。初次静态检查的一处测试格式问题已修正；小窗口恢复断言不再要求较早中断提示处于底部视口，仍通过子 Run 历史面板验证其准确中断原因。未运行全量测试。
