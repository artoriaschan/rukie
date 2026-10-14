# 06：整体验收

Status: resolved

Blocked by: 01, 02, 03, 04, 05

**What to build:** 对整份 [spec](../spec.md) 做交付验收。复用各工单已有的验证证据，只补充被后续改动失效的部分。

- [x] 对照 spec 的 User Stories 与 Implementation Decisions 检查实现，并完成 [ADR Coverage](../spec.md#adr-coverage) 审阅：ADR-0041 更新从 proposed 转为确认，链接与状态正确
- [x] DESIGN.md、CONTEXT.md、ADR、README 与实现一致；zh 与 en 文案完整
- [x] `bun run check:dev` 通过；受影响的 server、ui-node、ui-browser 测试有通过证据
- [x] 以 `bun run dev:desktop:web --isolated` 做一次 agent-browser GUI 验收：外壳三栏与阴影、创建、信任、编辑、移除、详情卡、项目行；覆盖 Light、Dark、窄宽度、光标、hover、焦点、控制台与网络。完成后关闭浏览器会话并停止启动器
- [x] 记录验证结果与剩余限制，所有工单与 spec 状态更新为 resolved

## Comments

- 2026-10-14：新的 06 实现代理在独立工作树 shell-palette-06/rukie、分支 test/project-management-acceptance 认领；基于已集成复审修复 821c1038，复用验证记录中的有效 focused 证据。当前只补充首次 check:dev、适用 desktop 包级和一次隔离 Chromium GUI 验收。

- 2026-10-14：整体验收完成，50 项故事逐项对应当前源码、已有 focused 证据与本票手工 GUI；ADR0041/0031 accepted，spec 覆盖表已确认并补充历史 cwd 别名执行信任归属。静态采用首次 check:dev 的通过前置阶段与最小 unused export 修正后的 Knip/下游/受影响 scoped 结果组合，不把首次失败改写为通过。desktop 首次整包实际 236 pass / 2 fail、43.93s；两项失败最小复现后修正并 2 pass / 26 skip、3.32s，未整包重试。C27 被动点击后 Esc 新缺陷先 red，再由 ProjectDialog 的非 Tab 序焦点承载修复；C28/C29/C31 取消返回、pending 与几何相关 8 pass / 20 skip、13.57s。C30 英文改为 Sessions: count，两消费者 2 pass / 21 skip、3.63s。真实 legacy alias hook 回归先失败，再以相同目录身份的 trusted owning Project 派生 cwd spelling 修复；相关 3 pass / 55 filtered、51 assertions、2.21s，单例均低于 1s。
- GUI：一次最终隔离 Chromium 验收覆盖 Home/Session/Settings、C27–C31、Light/Dark/420px、hover/焦点/光标、主目录继任与最后目录保护、信任取消/新增标记、真实 create/update/remove 与当前 Session/Transcript/置顶保留、详情卡 4px 通道/固定/键盘/夹取、长路径及 console/network。后续可见差异只复查 Esc 区域和英文 C30；其他证据复用。有效截图目录为 `/Users/chenzheng/.codex/visualizations/2026/10/14/01a138a9-fed3-7e92-bc38-1b2e53ed718c/shell-palette-project-management`。所有命令、源状态、失败截图与故事/ADR 审阅见 `/tmp/rukie-shell-palette-evidence/ticket06.md`、`story-audit06.md`。
- 边界：picker 仅在临时未提交 HTML 中替代为 unsupported 错误及隔离真实目录队列，App/WS/server 保持真实；macOS ordinary Web 本来支持原生 picker，初始计划假设被源码推翻，一次 picker 命令已取消且未选择目录。初始 localhost IPv6 页不是本票源码，已排除并用本票 IPv4 resolver 保持同 Origin 验收。没有 Electron/钥匙串/真实配置或 Session 验收。工具 about:blank 恢复事件不视为 App 缺陷；实际路径选择正常，剪贴板读取权限不足所以不声称复制验证。console 无错误，网络仅临时 HTML 缺省 favicon 的 404，生产页面有内联 favicon。浏览器均关闭，两次启动器退出 0 并删除隔离目录，临时 HTML 已删除，其他已有 Vite 未更改。
- 全部工单与 spec 在本次本地验收变更中关闭；resolved 不代表 CI 已通过、PR 已 ready 或已合并。PR #24 的旧远端绿色提交不是本次验收证据，最终提交/CI 与合并授权由主流程负责。

- 2026-10-14 后续 F01 样式交付：按用户最新 DESIGN.md 要求同步共享主题、Button/Input/Select/Switch/Checkbox/Radio/Badge、菜单/提示及实际页面消费者；浅色主按钮黑底白字、深色白底黑字。保留三栏 52/268/44px、4px 留白及设置/项目/输入区专用几何，未修改 wire、执行、依赖或锁文件。独立的新实现、双轴审查、修复和集成代理分别交付 `0ee4858f`、`56723e3d`；审查发现的焦点悬停覆盖、危险菜单对比度、Light 凭据状态颜色及虚拟时钟清理均已修正并定向验证。ADR Coverage 复核：仅视觉和测试清理约束由 DESIGN.md/docs/testing.md 维护，无新增架构决定。
- F01 验证：首次 `check:dev` 因工作树依赖链接跨 checkout 在类型阶段失败；修正任务依赖链接后，仅失败的类型与未执行下游静态阶段通过，后续修改完成 scoped 检查。首次 `test:desktop` 实际 242 passed / 3 failed（42 files，57.79s）；旧 hover/focus 断言和 API Key 非计时用例受真实 debounce 干扰均最小复现并修正，三个因果用例 3 passed（4.35s），未重复整包。审查修复的焦点、危险菜单、凭据状态与清理用例全部通过。最终真实隔离 Chromium 验收覆盖 Home/Session/Settings、项目创建/编辑/新增目录信任、模型保存、下拉与右键菜单、Light/Dark/System Dark、1280px/420px、键盘焦点与真实 pointer、禁用光标及路径文字选择；控制台无应用错误，142 条网络请求全部 200。模型 footer 取消 68×36/保存 128×36/12px 圆角、标题栏 44px 和专用布局保持。实际浏览器 locale 为 zh-CN；临时 HTML 仅替代 picker，使用真实 App/WS/sidecar/隔离假供应商。一次窄屏背景关闭按钮中心点击被侧栏覆盖，改走标题栏切换按钮成功；未强制点击或修改布局。未进行 Electron 或剪贴板读取验收。浏览器关闭、启动器 Ctrl-C 退出 1，所属 provider/sidecar/Vite 监听及隔离目录已消失；临时 HTML/目录已清理，已有 IPv6 Vite 保留。完整命令、首次失败与截图保留在本地 `f01-basic-styles/evidence/verification.md`；本地完成不代表最新 PR CI 或合并已完成。

- 2026-10-14 即时交互修复：按用户补充约束同步 DESIGN.md，Project 详情、右键/更多及其子菜单、Select 和动作 Popover 直接呈现最终几何并即时隐藏；Button/Link、Checkbox/Radio/Switch、状态按钮标签、点击切换的 glyph 与实际可点击消费者保持静态 hover/pressed/focus/selected，不添加点击动画。保留 Project 300/150ms 意图延迟、4px 指针通道、独立 dialog/search 与 Run/内容展开语义动效、鼠标 Preview Rail proximity；tap 的 Preview Rail 状态即时。删除旧液体层/clip/点击缩放/ripple API 与对应消费者 CSS。子菜单向左翻转时直接进入关联菜单的鼠标 leave 交给真实 submenu，避免 Radix 旧方向记录将焦点移回父菜单而误关闭。ADR Coverage 复核：纯视觉/交互呈现约束由 DESIGN.md 维护，没有新增领域或架构决定。
- 本次新实现代理在独立 instant-controls 工作树从 `0e039b5f` 实现；公共渲染红例确认正常 motion 下 Project clip 尚未展开、ContextMenu 有活跃动画、Button 有120ms状态过渡、ActionSwap 标签淡入与 Preview Rail tap 未到最终宽度。受影响消费者初次51例实际49 passed/2 failed；composer 被旧液体层 CSS 错误隐藏、左翻转 Session submenu 直接跨入时误关闭均按公开行为定位并修复，原断言保留。完整失败、定向复验、静态和 cleanup 证据保留于本次验证记录。手工隔离 GUI、最终集成/PR/CI 状态由主流程补充；复用已有包级证据，不将初次整包失败描述为全部通过。

- 2026-10-14 即时交互最终验收：`e29353bb` 由全新实现/子菜单只读调查/双轴审查/集成代理完成，Standards 与 Spec 均 0 finding；真实隔离 App/WS/fake provider 验证项目详情、更多/右键菜单、向左翻转子菜单、选择面板、输入区上下文及开关。正常 motion（非 reduced）下 Project 320px / 4px 锚点、opacity1 / clip none / transition0s / animations0，菜单/子菜单亦0；真实点击把 Session 从 A 移到 B，Escape/方向键和焦点恢复正常，pointerdown无 transform/transition/animation，静态 hover/focus/pressed 保留。Light/Dark、1280px 与窄屏已检查；项目详情窄图实际420×900，浏览器恢复后的菜单窄图实际500×757，不混称420。共享 checkbox/radio/Select 的完整即时行为由公开自动用例覆盖；后续手工 checkbox/radio 因工具两次 about:blank 未完成，不声称通过。无应用 console error；网络364条记录含恢复时部分无完成状态，已完成记录200，不将未完成记录视为成功。无 Electron/钥匙串/剪贴板验收。
- 本次 GUI 发现同一 checkout 的已有 IPv4 Vite79351与旧 IPv6 Vite26114；两者保留，使用 `webDevelopmentPaths({isolated:true})` / `runWebDevelopment` 的既有入口和 `viteCommand` 注入仅验证当前 Vite fixture HTML/代理 module readiness，任务独立 sidecar/config/data/memory encryption/fake provider。初始导出名错误在创建前退出；首次 ready 检查因 Vite 把 inline script 提到 html-proxy 而拒绝，改为同时核对 title 与 proxy 源标记后启动，均记录为环境准备失败。最终浏览器关闭，任务 launcher Ctrl-C退出1，所属53953/53961监听和隔离目录消失，临时 HTML/选择器目录清理；已有 Vite保持运行。about:blank采样排除，恢复后仅继续未完成区域。
- 额外锚点审计：上下文面板在 trigger 关闭期间只改变位置、不改尺寸时可能使用旧矩形。全新隔离诊断代理的同一公开用例在 `e29353bb` 与前基线 `0e039b5f` 均失败（期望4px、实际-316px，1.68s/1.40s），定位 owner 本次未改，确认既存问题；未扩大动画修复范围。复现、两份日志与截图保留在 `instant-controls/evidence/anchor-check.md`。本次目标动画修复通过，既存锚点缺陷不宣称修复；最终 PR CI 由主流程核对，尚未授权合并。
