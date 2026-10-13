# 06：整体验收

Status: claimed

Blocked by: 02, 03, 04, 05

**What to build:** 对整个会话侧栏重构做交付验收，确认布局、交互与文档一致后关闭 spec。

- [x] 按 DESIGN.md layout preservation gate 重跑 shell、transcript、dock、composer 与侧栏几何用例，未授权差异全部修复
- [x] 使用 agent-browser 在 `bun run dev:desktop:web --isolated` 下验收侧栏三分类、行尾操作、右键与更多菜单、重命名、归档、永久删除与搜索浮层；Light、Dark 与窄宽度截图；检查 cursor、hover、焦点、控制台与网络错误
- [x] 按验证记录规则运行受影响测试与 `bun run check:dev`，记录结果
- [x] 完成 spec 的 ADR Coverage 审阅，确认 CONTEXT.md、DESIGN.md 与实现一致
- [ ] 关闭本票并将 spec 设为 resolved

## Comments

06 的实现与本地增量验收完成，状态保持 claimed，关闭动作等待主代理的 Standards / Spec 双轴代码审阅。spec 同样保持 claimed。

验收修复三个拥有者缺陷：关闭的旧持久化历史没有当前协议 coordinator 时，Core 只读 busy 查询返回 idle 且不创建文件；CommandPalette 订阅实时 reduced-motion 偏好；Button、侧栏和菜单补齐 cursor、hover/pressed/focus 与 disabled 指针/键盘阻断。使用既有 beUI 与 shadcn 角色，没有新增组件、依赖或布局尺寸；启动 busy 测试改用公开 Core lease，删除失效的私有路径假设。

初始 `rtk proxy env -u NO_COLOR bun run check` 仅运行一次：check:dev 全通过；Bun 外层 3527 pass、20 fail、2 errors、3547 tests / 338 files，532.16s，总计约 571s，exit1，desktop 未执行。嵌套 release child 的失败计数单独保留。与原 main 46a643e2 相同 frozen lock / Bun1.4.2 / Node24.15.0 的最小失败组对比，五个相同失败在基线重现；一个当前变更失效的 startup fixture 已修复；其余十四个原始失败在当前最小范围通过，全套压力下的交互原因仍未证明。原始全量失败不改写为通过。

初始 `bun run test:desktop` 为 169/170、33 files、33.10s、exit1。shell、transcript、dock、composer 与侧栏几何全通过；唯一 reduced-motion 失败由挂载后切换媒体偏好的公开用例稳定复现并修复。复用其余 169 项通过证据，增量 live-motion/几何/键盘 3/3、共享 Button/disabled 菜单/modal/composer 代表场景 5/5、overlay cursor 精确用例通过；受影响 format、lint、类型检查通过，没有重复全套或 desktop package。

隔离 Chromium 验证三分类与五项展开、pin/unpin、真实右键与键盘菜单、未打开/当前 Session 无 Run 重命名、归档、永久删除确认/取消、全量搜索/Project 过滤/快捷键/箭头/Tab/Enter/Escape/焦点，以及 nested cursor、disabled 命中和激活阻断。Light、Dark、420px 窄屏截图保存在外部持久目录 `/tmp/rukie-session-sidebar-evidence/gui`，包括 `15-light-header-menu.png`、`16-light-delete.png`、`17-light-search.png`、`14-dark-search.png`、`23-dark-narrow-sidebar.png`。初始缺陷图与原始 JSON 也保留。最终新会话只读页面日志无 console error，133 个网络请求均 HTTP200；日志覆盖其采样页面，不替代先前会话全部延迟回调日志。

目录入口在 macOS 隔离 sidecar 实际调用了 osascript 原生选择器，因此不宣称原生选目录验收。经授权只对公开 `host.pickFolder` 返回既有 `unsupported` 错误，其他流量保持真实 sidecar；`24-folder-fallback.json` 证明一次 mocked picker、一次真实 `project.add` 与搜索触发器焦点恢复。两个 picker、launcher/sidecar PID 均已退出，两个浏览器会话关闭且 session list 为空，临时隔离目录已删除；launcher 的主动 Ctrl-C 实际 exit1、无错误栈。

ADR Coverage：实际 store/title-only ownership、永久外部 canonical mutex、升级前旧 host 关闭、archive registry 与完整删除根已由 ADR-0035 覆盖；仅补齐 inactive history 的只读说明和 agent README。CONTEXT、DESIGN、双方语言与实际 UI source roles 一致，没有未覆盖的持久架构选择。完整协调记录与原始日志位于 `/tmp/rukie-session-sidebar-evidence/06-verification.md`，手工发现位于其 `gui/findings.md`。全量失败与原生 picker 限制保留给最终审阅。
