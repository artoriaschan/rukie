# 06：整体验收

Status: resolved

Blocked by: 02, 03, 04, 05

**What to build:** 对整个会话侧栏重构做交付验收，确认布局、交互与文档一致后关闭 spec。

- [x] 按 DESIGN.md layout preservation gate 重跑 shell、transcript、dock、composer 与侧栏几何用例，未授权差异全部修复
- [x] 使用 agent-browser 在 `bun run dev:desktop:web --isolated` 下验收侧栏三分类、行尾操作、右键与更多菜单、重命名、归档、永久删除与搜索浮层；Light、Dark 与窄宽度截图；检查 cursor、hover、焦点、控制台与网络错误
- [x] 按验证记录规则运行受影响测试与 `bun run check:dev`，记录结果
- [x] 完成 spec 的 ADR Coverage 审阅，确认 CONTEXT.md、DESIGN.md 与实现一致
- [x] 关闭本票并将 spec 设为 resolved

## Comments

06 的实现与本地增量验收完成，状态保持 claimed，关闭动作等待主代理的 Standards / Spec 双轴代码审阅。spec 同样保持 claimed。

验收修复三个拥有者缺陷：关闭的旧持久化历史没有当前协议 coordinator 时，Core 只读 busy 查询返回 idle 且不创建文件；CommandPalette 订阅实时 reduced-motion 偏好；Button、侧栏和菜单补齐 cursor、hover/pressed/focus 与 disabled 指针/键盘阻断。使用既有 beUI 与 shadcn 角色，没有新增组件、依赖或布局尺寸；启动 busy 测试改用公开 Core lease，删除失效的私有路径假设。

初始 `rtk proxy env -u NO_COLOR bun run check` 仅运行一次：check:dev 全通过；Bun 外层 3527 pass、20 fail、2 errors、3547 tests / 338 files，532.16s，总计约 571s，exit1，desktop 未执行。嵌套 release child 的失败计数单独保留。与原 main 46a643e2 相同 frozen lock / Bun1.4.2 / Node24.15.0 的最小失败组对比，五个相同失败在基线重现；一个当前变更失效的 startup fixture 已修复；其余十四个原始失败在当前最小范围通过，全套压力下的交互原因仍未证明。原始全量失败不改写为通过。

初始 `bun run test:desktop` 为 169/170、33 files、33.10s、exit1。shell、transcript、dock、composer 与侧栏几何全通过；唯一 reduced-motion 失败由挂载后切换媒体偏好的公开用例稳定复现并修复。复用其余 169 项通过证据，增量 live-motion/几何/键盘 3/3、共享 Button/disabled 菜单/modal/composer 代表场景 5/5、overlay cursor 精确用例通过；受影响 format、lint、类型检查通过，没有重复全套或 desktop package。

隔离 Chromium 验证三分类与五项展开、pin/unpin、真实右键与键盘菜单、未打开/当前 Session 无 Run 重命名、归档、永久删除确认/取消、全量搜索/Project 过滤/快捷键/箭头/Tab/Enter/Escape/焦点，以及 nested cursor、disabled 命中和激活阻断。Light、Dark、420px 窄屏截图保存在外部持久目录 `/tmp/rukie-session-sidebar-evidence/gui`，包括 `15-light-header-menu.png`、`16-light-delete.png`、`17-light-search.png`、`14-dark-search.png`、`23-dark-narrow-sidebar.png`。初始缺陷图与原始 JSON 也保留。最终新会话只读页面日志无 console error，133 个网络请求均 HTTP200；日志覆盖其采样页面，不替代先前会话全部延迟回调日志。

目录入口在 macOS 隔离 sidecar 实际调用了 osascript 原生选择器，因此不宣称原生选目录验收。经授权只对公开 `host.pickFolder` 返回既有 `unsupported` 错误，其他流量保持真实 sidecar；`24-folder-fallback.json` 证明一次 mocked picker、一次真实 `project.add` 与搜索触发器焦点恢复。两个 picker、launcher/sidecar PID 均已退出，两个浏览器会话关闭且 session list 为空，临时隔离目录已删除；launcher 的主动 Ctrl-C 实际 exit1、无错误栈。

ADR Coverage：实际 store/title-only ownership、永久外部 canonical mutex、升级前旧 host 关闭、archive registry 与完整删除根已由 ADR-0035 覆盖；仅补齐 inactive history 的只读说明和 agent README。CONTEXT、DESIGN、双方语言与实际 UI source roles 一致，没有未覆盖的持久架构选择。完整协调记录与原始日志位于 `/tmp/rukie-session-sidebar-evidence/06-verification.md`，手工发现位于其 `gui/findings.md`。全量失败与原生 picker 限制保留给最终审阅。

审阅修复补充：服务端归档拒绝外部 Core 写者和整条已接收命令，归档/删除在首个 await 前同步独占准入，拒绝反向并发 prompt；保留空闲被动订阅归档。Core 两种后端在只写标题提交前共用只读 metadata id/cwd 校验，身份不符不修改持久化数据。删除确认用已有 foreground-inverse 对比前景和危险 pressed fill，长标题与错误放入可收缩 A13 body，Cancel 保持初始焦点；普通标题几何仍为 480×190。上述局部修复没有新依赖、存储协议或外壳尺寸变更，ADR-0035 与 DESIGN 的现有所有权覆盖，无需新 ADR。具体 red/green、增量验证和局部 GUI 记录见本轮交付证据；原全量失败保留，状态仍 claimed 待最终审查关闭。

审阅修复验证：Core 身份校验 4 项复用通过加 SQLite 精确增量 1 项；归档/删除公开 wire 7/7，加实际已打开 Session 的 prompt-first 增量 1/1。删除颜色的 Chromium red 证明 Light pressed 错继承 primary、对比仅 3.71:1，修复后两主题 default/hover/pressed 全达 4.5；长标题 red 证明窄高 footer bottom 2283px，修复后普通 480×190 不变，420×320 与 14/18px 字体下 body 滚动、footer 持续可见且 Cancel Enter 无删除，精确增量通过。delete 消费者 5/5、rename 代表消费者 2/2、agent/server/ui types、changed-file lint、docs147 与 test-policy422 通过。局部隔离 GUI 的实际鼠标对比 Light 5.24/4.67/5.24、Dark 5.65/4.80/5.65；15999 字标题在 18px 窄高屏滚动到末尾时 footer bottom 279，标题栏仍 44。console error 为空，133 HTTP 请求均 200；浏览器和 launcher/sidecar 已停止，隔离根已删除。截图与原始 JSON 存于外部 `/tmp/rukie-session-sidebar-evidence/review-gui`；即时 Cancel 后的退出帧采样仍保留，不以该帧宣称 settled closure，公开 App 回归明确验证关闭。

第二次只读审阅发现并修复组织操作的闲置清理：归档 discovery/save/broadcast 跨过已有 idle deadline 时，准入释放后的 finally 对仍存在的 Session 重新安排计时，成功与异常均覆盖；删除已移除的 Session 不重新打开。公开 onWarning 与临时损坏文件控制 discovery 边界，现有虚拟 clock 分别证明截止前 lease busy、截止时 closedSessionId 与公开 createSession 可重新取得 lease。成功、异常均先确定性 red，再修复；新两项与旧 idle/订阅归档/删除/并发准入消费者共 6/6，case 最长 185ms。只修复 server 资源生命周期，无 UI、Core 协议或架构扩展，已有所有权覆盖无需新 ADR；原全量失败及 claimed 状态保持。详细日志与增量检查保存在外部 idle-cleanup-verification.md。

最终交付审阅：以 main 基线 46a643e2 对照实现，两个全新只读代理分别完成 Standards 与 Spec 轴。Standards 的 3 项 P2（危险按钮对比、长内容 body、JSONL 身份校验）和 Spec 的 1 项 P1（归档执行准入）均由一个新的实施代理修复；新的只读代理确认原四项已解决，并指出组织操作 idle finally 的 P2 回归。该增量由另一个新的实施代理修复，最终新的只读确认代理报告已解决 1、剩余 0。所有集成均由新 merger 快进，源码与验证提交的 tree 相同；行为实现最终为 02e6b3f7，记录在外部 review.md、review-fixes-confirmation.md 与 idle-cleanup-confirmation.md。

后续本地整套复验（56c32394）实际为 3550 pass、5 fail、3555 tests / 338 files、516.33s；静态通过，desktop 独立 172/172 通过。用户扩大授权为复现并修复全部五项及整套交互，再完成完整本地验证。公开 Store commit barrier 证明模型 header 先于持久化完成；下一 prompt 的忙错误由等待已提交的 Model changed notice 修复。公开主模型 barrier 证明权限评审的 300ms 包含 Run 准备，改为两项 review 同时开始且未结束、未写文件的功能合同。Rewind 保留二十次真实 Run 与原窗口断言，改为先创建历史再恢复 TUI，避免重复绘制二十次。发布信息命令与独立 tag 门禁分开，各自保留默认界限和结果断言；fixture 停止新工作、取消并等待子进程退出，再恢复资源。

组合复现还证明只复用基础包不足以修复混合阶段：相同九个原始用例、四个 worker、共享基础包仍出现 rewind 初始终端 parse 失败；移出源码阶段后，四个发布 worker 仍会使嵌套实际 adapter 验收超时并出现迟到的 143 断言。无参数本地 test 入口分为四个阶段：Agent Core 模块测试、其余 workspace 与脚本测试保留配置的 worker 数（默认四个），Agent Core e2e 的真实 Session 集成使用一个 worker，coding-agent 前端与进程测试使用一个 worker，真实发布阶段使用一个 worker；有参数或 CI 提供包时保持 Bun 原生收集与 shard 语义。该变化只涉及测试执行与资源所有权，沿用 ADR-0004 和 testing.md，无生产 Session 协议或架构决定变化。新的 Standards / Spec 代理发现过期测试体阻止 finally 后的资源恢复，交由另一个全新实施代理补齐 owner 清理与实际超时回归。完整通过结果将在最终复验后追加，原始失败日志保留。

ADR Coverage 最终核对：只写标题、规范单写者租约、完整删除及桌面 registry 组织状态由 ADR-0035 覆盖；执行准入和 idle 释放沿用 server 资源所有权，未增加协议或架构取舍。搜索与弹窗的局部尺寸、对比和滚动规则由 DESIGN.md 拥有，CONTEXT.md 与两种语言契约一致，无遗漏的持久决定。关闭 06 和 spec 的本次变更仅更新交付记录，复用已有行为、静态和 GUI 证据；执行文档、tracker、格式与 diff 检查。原完整检查失败、desktop 首次失败和未解释的整套交互保持上述事实，resolved 不表示整套验收、CI 或合并已通过。最终推送至 PR #21，最新提交 CI 待验收；未授权合并 main。

本轮完整检查的第一次实际结果为静态通过、源码 3399 pass / 56 fail / 15 errors（3455 tests / 328 files，395.33s），发布和 desktop 因前序失败未执行。相同 59 个失败相关用例对照证明测试进程的 `--no-orphans` 会破坏 escaped descendant 契约，移除后该精确用例通过；仅基础包构建保留该参数。修复终端 parser 的资源所有权及退出请求边界后，相同 64 个用例由四个 worker 的 54 pass / 10 fail / 1 error 变为一个 worker 的 63 pass / 1 fail；剩余的 child resume 用例在发送退出键前等待公开 committed output，精确增量通过。原失败结果保留，最终整套验收尚待执行。

终端回归通过公开 stdout 注入 ANSI、汉字和 ZWJ，两种 terminal factory 都强制实际 parser performance 每次推进 13ms，覆盖超过 xterm 12ms 的异步 continuation；前端 Date、1ms 截止期限保持冻结。原共享 helper 对同一控制用例 0 pass / 2 fail，资源隔离后 2/2 通过（22.86 / 8.33ms），全部颜色、字符宽度、两次 write callback 和时钟断言保持。仅测试时钟/进程所有权发生变化，仍使用锁定 xterm 与 Bun，不涉及 GUI 或 Session 生产语义；无需新 ADR。

第二次整套检查静态通过，但核心组合阶段实际 1928 pass / 3 fail / 2 errors（1931 tests / 149 files，111.93s），后续阶段未执行。精确三项相同四 worker 为 3/3；同一 1931 项仅改为一个 worker 后 1931/1931（238.62s），证明组合执行条件影响真实 Session 的期限，未发现共享目录、设置、模型或权限状态。因而真实 Session e2e 单独使用一个 worker，Agent Core 模块、其余 workspace 和脚本仍并行，不改变 CI/shard 原生路径。另修复已确认的超时后操作清理，并用既有长路径方案降低 near-full 预算集成的真实提交数量；具体增量和最终结果待追加。

第三次整套检查静态通过；模块/脚本 483/483（45 files，8.45s），Core e2e 1450/1450（105 files，223.96s），前端 1523 pass / 3 fail / 2 errors（1526 tests / 180 files，356.67s），发布及 desktop 未执行。三个 Logo 动画失败是本轮终端隔离修复与残留 Bun 内建假时钟的兼容性回归：原 56 helper 对照 3/3，修复后的共享 parser 加旧 clock 精确 0/3；公开 Node timer 对照证明 Bun fake mode 接管预先捕获的函数，而既有 testClock 保留真实 parser I/O。只换 clock provider 为 3/3；新的独立实施代理补同幂等 owner 与原 React act 属性恢复，Logo 8 + parser 2 共 10/10、86 断言、904ms。没有生产 Logo 修改，原动画时间和断言保留；第三次完整失败也保留，最终完整验证待后续结果。

最终完整本地验证完成：`env -u NO_COLOR -u RUKIE_RELEASE_ARTIFACTS -u RUKIE_TEST_WORKERS bun run check` exit0。静态全部通过；模块/其他 workspace/脚本 483/483（45 files，8.63s），Core e2e 1450/1450（105 files，239.02s），CLI/TUI/renderer 1526/1526（180 files，368.05s），真实 release/install 113/113（12 files，320.53s）；Bun 合计 3572/3572、342 files、0 fail。最后 ui/desktop Vitest 172/172、33 files、43.30s。真实打包、npm、进程退出与恢复验收保留其不可虚拟化的集成成本；未以扩大原期限、重试或跳过取得通过。验证源码的 23 文件 SHA-256 在完整命令前后完全一致。原始五项和三轮修复中出现的完整失败均保留为历史事实，最小控制证据详见外部 diagnosis.md、verification.md 和 check-final-4.log。最终 fresh Standards / Spec 审阅及 Logo 时钟兼容确认均剩余 0。

ADR Coverage：本轮只修改测试合同、时钟/进程所有权和本地测试调度，沿用 ADR-0004 与 docs/testing.md；锁定 harness/xterm、生产 Logo、权限/通知和 GUI 行为没有新增架构决定。先前 Sidebar 实现和生产修复仍由 ADR-0035 与 DESIGN.md 覆盖。工单 01–06 和 spec 保持 resolved；本地验收现已完整通过，CI 和合并仍是独立门禁，PR #21 尚未合并。后续只补交付记录，复用完整结果；仅重查文档、tracker、格式与 diff。

合并后人工验收补充：用户明确要求新聊天按钮不显示快捷键，并要求顶部分隔线仅在列表溢出且 scrollTop>0 时显示，回顶或内容适配后隐藏。移除提示，复用既有 ScrollArea；Sidebar 自身观察 viewport、内容尺寸及滚动，透明分隔线保留原占位，卸载时断开 observer/listener。1280/420px 的公开键盘 End/Home、内容缩减与几何回归先 red（旧 ⌘N）后 green 2/2；完整 layout browser 4/4，4.77s；check:dev 全通过。既有 package/full 证据对未改变代码继续有效，没有重复整套。

实际隔离 Web Chromium 的 Light/Dark、420px 窄屏，以及缩短视口产生溢出的真实滚动验证通过；End 显示、Home 隐藏，扩大视口后无溢出与分隔线均恢复。按钮和嵌套 icon cursor 均 pointer，页面 error 为空，136 个 HTTP 请求均 200。新建独立 launcher 因既有用户服务占用 5173 而正确失败并清理，最终只读复用用户的既有隔离服务，未创建/删除任何 Session 或调用原生 picker；自己的浏览器会话已关闭，用户人工验收服务保留。截图和日志在本次外部 sidebar-divider 验证目录。仅局部视觉状态与原有组件组合，沿用 DESIGN.md，不需新 ADR。

设置人工验收补充：按 rukie.pen C03 xyqO6 移除顶部“返回应用”，设置导航直接从搜索框开始；搜索框 y96→60，268px 导航、52px 窄屏折叠和供应商工作区几何保留。删除废弃 close prop、双语文案和窄屏按钮样式；标题栏后退保留草稿、卸载刷新自动保存。宽屏聚焦当前设置项且不滚动，窄屏聚焦稳定设置容器，避免供应商加载替换按钮造成焦点丢失。新增几何先 red2/2；四文件首次64 pass/2 fail（测试旧入口/同名 locator），两失败及几何增量4/4；焦点修正增量3/3。check:dev 通过，后续变动增量格式/lint/types 通过。真实隔离 Chromium Light/Dark/420px、标题栏点击后退和键盘前进、草稿保留、搜索位置及无横向溢出通过；窄屏供应商加载完成仍保持焦点。页面 errors为空，HTTP请求均200。外部 settings-navigation 记录保存全部结果和截图；用户既有人工验收服务继续运行。沿用 C03 与 DESIGN.md，不涉及新架构决定。

人工验收全局交互补充：DESIGN.md 规定界面禁止快捷键提示，选项 hover/键盘高亮切换即时生效、不使用跨项共享背景动画；C02 分类与会话均为默认 14px normal，所有会话静止背景透明，保留当前项语义及焦点。清除会话编号、会话菜单、删除弹窗及批准/拒绝按键提示与废弃展示组件，实际按键功能保留。搜索/ContextMenu/Select 移除选项背景过渡。有效 red 覆盖分类 12px→14px、删除弹窗 kbd 和选项 transition；test:desktop 首次 173 pass / 2 fail（旧提示断言与错误 Pin fixture 预期），修正测试后仅失败两项增量 2/2，其他 173 项证据复用。check:dev 全通过；浏览器 Light/Dark/420px 搜索 hover 与方向键检查背景立即切换、transition 0s、动画 0、kbd 0、分类 14px，页面 errors 为空。当前隔离开发页没有可见 Session，尝试临时假供应商输入后仍无会话；会话项几何、真实 hover、透明选中态及键盘通过 Chromium 自动测试验证，未扩展修复运行问题。自己的浏览器已关闭，用户 launcher 保留。外部 sidebar-interactions 保存完整失败、局部复验和截图。仅共享呈现角色调整，沿用既有 DESIGN.md 与 GUI ADR，不新增架构决定。

重命名弹窗人工验收补充：保存按钮此前未局部覆盖全局 GitHub primary，所以仍呈蓝色；仅该按钮补上 Light 黑底白字、Dark 白底黑字并保持 hover/pressed 填充，禁用和焦点保留。Input 外侧 ring 被重命名内容滚动容器裁切，改为字段圆角内侧 focus/error ring，所有已有尺寸不变。DESIGN.md 明确两个角色。有效 red：按钮 1 fail（蓝色而非黑色），焦点/错误环 2 fail（外侧阴影）；相关 5 文件 50/50、29.87s，覆盖 rename、Input、semantic roles、compact foundation、model-services，check:dev 全通过。实际 Vite 组件临时预览注入测试 Session/callbacks，在 Light/Dark/420px 验证黑白保存、hover、8px 圆角内侧焦点环，页面 errors 空；无真实 Session 修改，预览文件和自己的浏览器已清理，用户 launcher 保留。外部 rename-focus 记录截图及日志，复用其他有效 package 证据；局部视觉修复沿用 DESIGN.md 与既有 GUI ADR，不新增架构决定。
