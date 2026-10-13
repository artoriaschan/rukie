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

ADR Coverage 最终核对：只写标题、规范单写者租约、完整删除及桌面 registry 组织状态由 ADR-0035 覆盖；执行准入和 idle 释放沿用 server 资源所有权，未增加协议或架构取舍。搜索与弹窗的局部尺寸、对比和滚动规则由 DESIGN.md 拥有，CONTEXT.md 与两种语言契约一致，无遗漏的持久决定。关闭 06 和 spec 的本次变更仅更新交付记录，复用已有行为、静态和 GUI 证据；执行文档、tracker、格式与 diff 检查。原完整检查失败、desktop 首次失败和未解释的整套交互保持上述事实，resolved 不表示整套验收、CI 或合并已通过。最终推送至 PR #21，最新提交 CI 待验收；未授权合并 main。
