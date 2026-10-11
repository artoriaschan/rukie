# 28: ui 窗口外壳、侧栏、新会话与连接状态

**What to build:** wire client、store 与主窗口骨架：外壳、侧栏四分组、搜索浮层、欢迎页与输入框（发送、权限模式、模型、上下文环），以及断开与重连。见 [spec](../spec.md) 的「主窗口布局」中的窗口外壳、侧栏、主区域（欢迎页）、输入框、断开与重连、菜单与 tooltip。

Blocked by: 24, 27

Status: resolved

- [x] `client`：连接、重连（每次重新 `getConnection`）、请求 `id` 关联、订阅与 `superseded` 处理；`store`：Session 列表、注册表偏好与连接状态归约；两者用 Vitest Node 环境测试
- [x] 外壳、导航栏（只有首页）、侧栏四分组、折叠、显示与排序菜单、⌃1–⌃9、⌘N、⌘K 搜索浮层、置顶，偏好经 `preferences.set` 保存
- [x] 欢迎页切换目标项目或默认工作区；首次发送 `session.create` 后切到对话视图
- [x] 添加项目走 `host.pickProjectFolder`，浏览器开发模式改为手动输入路径
- [x] 输入框：Enter/Shift+Enter/输入法、图片附件、权限模式菜单、模型与推理档次列表、上下文用量环与面板
- [x] 连接状态：重连中、已断开与「重试」，断连期间禁止发送
- [x] 会话更多菜单：置顶、复制、在 Finder 中显示、在终端中打开（开发模式隐藏后两项）
- [x] 接缝：Vitest browser mode 渲染 `app` + 脚本化 wire server；覆盖键盘、焦点、可访问名称与窄窗口；完成后 GUI 浏览器验证

## 实现与验证证据

- 完成 app / components / store / client / host 五层：实际入口替换临时 gallery，复用 27 的 beUI Button、PromptInput、Popover、CommandPalette、MorphingModal 与 tooltip，导航/菜单复用已安装 shadcn DropdownMenu。自定义 shell、sidebar 与 context ring 组合这些原语，因为现有组件没有注册表四分组、原型窗口骨架或 server ContextReport 的对应展示。没有增装重复原语。Zustand vanilla store 安装精确版本 5.0.15；Agent Core 仅 type import。
- client 请求 id 关联、并发逆序回复、断开待处理请求拒绝、每次重新 getConnection 和 resubscribe、superseded / host 最终 disconnected 保持断开直到 Retry；自动 resubscribe 的 session_busy 归约到只读快照和重试。wire error 闭集、模型目录、registry/context/Interaction 的消费字段在边界校验，畸形 envelope 不污染现有状态。
- sidebar 四分组、折叠、显示、排序、置顶、编号快捷键、项目关键字搜索、焦点恢复；欢迎页目标项目与默认 workspace，首次发送携带 model / thinking / permission / images 创建 Session。浏览器提供手工绝对路径项目入口，缺少 native host 时隐藏 Finder / Terminal。
- Composer 覆盖 Enter、Shift+Enter、IME composition、文件上传/粘贴/拖放、命名图片、权限描述和 Full Access warning、原生思考档次子集、context 环/分类/Opening Context/Compaction points。停止把返回的 Queued Input 文本及命名图片放到当前 draft 前；Run feedback 随 run_start/run_end 归约，避免 active snapshot 在 Run 完成后保持停止按钮。
- TDD 公共接缝：缺失 client / app 的 red → green；焦点陷阱、session_state、粘贴/拖放、重连后 busy 和畸形模型目录先复现失败再修复。只测试 public client/store 与 DOM 行为；真实 WS 的脚本化 wire server 不调用真实模型。Conversation 29 保留 App 的受控 ConversationProps 插槽，共享稳定的 SessionViewState 与 draft/images/request；此票不实现 Transcript 内容。
- `bun run test:desktop`：12 files / 35 tests pass，5.13s。浏览器完整 shell 用例约 1–2s 的成本来自 Chromium DOM、真实 WS 与动画/焦点交互，fixture 不调用模型；Node store/client 验证状态转移与畸形输入。
- `env -u NO_COLOR bun test packages/server/tests/server.test.ts`：15 pass / 0 fail，1.014s；覆盖 wire Type.Enum 修正后实际 create/model/mode 合约（原先数组 map 的 Type.Union 推断为 never）。`bun run check:dev` 通过；`bun install --frozen-lockfile` 无更改。
- README 精确 Vite 命令运行通过，实际打印 `http://localhost:5173/`，严格固定 port 避免 Origin 不匹配。`bunx --no vite build --config packages/ui/vite.config.ts packages/ui` 通过；658.70 kB 单 JS bundle / gzip 206.50 kB 的 Vite chunk warning 保留，没有隐瞒构建提示。
- 一次具名 `agent-browser --session rukie-desktop-28` 交付验收：真实 Vite localhost entry → 实际 server + fakeModel，临时 HOME；手动添加项目、first-send 持久化 Session、搜索与 Ctrl+1、native-less 菜单、draft 最终断开保留及 Retry，Light/Dark/420×800 无横向溢出。生产 bundle 再用 desktop 实际 `serveAppFile` 的 CSP 提供资源，scripts self / styles self+unsafe-inline，JS/CSS 200、无 inline script、无页面错误或 CSP violation。console 仅 Vite/React 开发信息及 reduced-motion 提示。浏览器与服务退出，临时 HOME 已删除；截图在工作树外 `/tmp/rukie-desktop-28-acceptance/light.png`、`dark.png`、`narrow.png`、`compiled-csp.png`。此为浏览器 acceptance，打包 Electron 验证属于 30。
- 等待独立 review 与集成；当前 checkbox 表示实现者已验证，尚未将 issue 标成 done。

## Answer

项目与 Session 侧栏、首发创建、输入/模型/权限模式、偏好及连接恢复已完成；侧栏摘要为权威状态，后台运行/审批/结算与重载回归通过。

最终代码集成 `8af81b85`；独立双轴评审、后续修复、适用本地验证和 ADR Coverage 结论见 [spec 的交付证据](../spec.md#delivery-evidence)。本地工作已完成，最终推送的 CI 尚待验收；此状态不表示 PR 已合并。
