# Desktop app wayfinding map

## Destination

桌面端 MVP 的 `spec.md` 与实现工单：架构、包边界、wire 协议、sidecar 生命周期、UI 选型与主界面布局全部锁定，可直接按工单开工。

## Notes

- Local Markdown tracker，工单在 `issues/`，答案写在各自 `## Answer`。
- 每次推进先读 [ADR-0001](../../docs/adr/0001-agent-runs-in-bun-sidecar.md)、[ADR-0004](../../docs/adr/0004-test-runner-per-runtime.md)、[ADR-0012](../../docs/adr/0012-single-coding-agent-package.md)、[ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md) 与 [tech-stack](../../docs/tech-stack.md)。
- grilling 工单调用 grilling 与 domain-modeling skill；GUI 外观问题走 prototype。
- 规划为主：产出决策，不在地图内实现。
- GUI 组件与样式严格遵循根目录 [DESIGN.md](../../DESIGN.md)，组件来源遵循 [AGENTS.md](../../AGENTS.md#ui-components)：组件、原语、动效与 Agent 执行反馈优先用 beUI（默认风格含 glass 表面），beUI 未覆盖的角色用 shadcn/ui，编辑器、终端、diff 与虚拟列表用专用库；颜色用 GitHub Light/Dark，字号用 `text-ui-*`，文案走 `@rukie/i18n`；Pencil 视觉稿只提供布局。

## Decisions so far

- [01: 包结构与 Effect 边界](issues/01-packages-and-effect-boundary.md#answer): 新建 `ui`/`server`/`desktop` 三包，`coding-agent/src/view/` 不抽取；Hono 做接入层，Effect 只在 server 内做业务运行层。
- [02: 连接与进程语义](issues/02-connection-and-process-semantics.md#answer): 单 sidecar 多 Session，token + Origin/Host 校验，断连不结算 Interaction，随机端口握手与崩溃重启一次。
- [03: MVP 范围与产品约束](issues/03-mvp-scope.md#answer): 目的地是 spec；浏览器仅作开发模式；最小闭环功能；沿用 Electron 选型；beUI 默认风格（shadcn 补位，见 07 的 2026-10-10 调整）+ Pencil 视觉稿布局；从一开始接 zh/en。
- [08: 确定 Pencil 视觉稿来源](issues/08-task-pencil-design-source.md#answer): `~/Desktop/rukie.pen`，MVP 参照外壳、会话侧栏、新会话、输入框与权限模式、Turn 指示器画板；工具调用块与权限审批卡片无画板，由粗稿补齐。
- [07: shadcn/beui 组件库](issues/07-research-beui.md#answer): beUI（`@beui` registry，MIT）经 shadcn CLI 安装，替代 ai-elements；2026-10-10 改为 beUI 优先、shadcn 补位；覆盖 MVP 主要组件，缺 Markdown 渲染与 i18n，Vite 8 构建未实测。
- [04: Effect 版本与 Bun、Hono 集成](issues/04-research-effect-on-bun.md#answer): 锁定 `effect` 4.0.2，暂不用 platform-bun；进程级 ManagedRuntime + Layer，Run 存于 server 级 FiberMap，中断经 AbortSignal 传给 Agent Core；TypeBox 校验后以 Static 类型进入 Effect。
- [06: 本机 server 的 WS 鉴权方式](issues/06-research-local-server-auth.md#answer): token 走 WS subprotocol，升级前中间件精确校验 Host/Origin/token；生产 Origin 为 `app://rukie`，token 经 preload `getConnection()` IPC 获取；开发模式直连 sidecar，token 走 URL fragment。
- [11: Bun sidecar 的打包与分发](issues/11-research-sidecar-packaging.md#answer): 每平台 `bun build --compile` 经 extraResources 放在 asar 外；`rg` 作为旁置文件传绝对路径；macOS 必须 `allow-jit`；fuses 2.0.0 需在 afterPack 调用；sidecar 关闭 dotenv/bunfig 自动加载并剔除危险环境变量。
- [05: Session store 写者 lease 的并发打开](issues/05-research-store-lease-concurrency.md#answer): lease 按 Session 粒度、同 id 后到者立即失败、崩溃由内核释放；server 需单飞打开并共享 Session，Agent Core 需类型化 busy 错误与容错 `list()`，孤儿 Background Job 待定。
- [12: Agent Core 在 server 中的直接调用](issues/12-research-agent-core-in-server.md#answer): `@rukie/agent` 可直接 import，按 Session 传 cwd/homeDir 支持多项目；server 负责 Interaction 桥接回调、单飞打开与 `onWarning`；Agent Core 需先类型化 busy 错误并让 `list()` 容错。
- [09: 主界面粗稿](issues/09-prototype-main-window.md#answer): 第九轮粗稿已确认：Codex 式外壳、四分组侧栏、折叠 Turn 对话流、输入框上方停靠审批、上下文环与模型详情；组件来源同时改为 beUI 优先、shadcn 补位。

## Not yet specified

- 需要新增或修改的 ADR 清单（推翻 ADR-0012 “view 抽成 UI 包”、Effect 在 server 的定位、shared 中的 wire 协议），在协议与研究结论之后统一起草。
- ADR-0003 与现状冲突：它写“桌面端用 SQLite”，但 ADR-0024 下 SQLite 只持有写者 lease。待确认桌面端是否沿用同一 JSONL store（TUI 与桌面端互见 Session、共享单写者 lease），并将 ADR-0003 标为被 ADR-0024 替代。
- `packages/ui` 内部分层（组件、Zustand store、server client、host 接口）与 lint 边界规则。
- Vitest 引入方式：`ui` 的 browser mode、`desktop` main 的 Node 测试，以及与根 `bun run check` 的集成。
- spec 撰写与实现工单切分顺序。
- 编辑器、终端、diff、虚拟列表各用哪个专用库（tech-stack「组件原语」已改为 beUI 优先 + shadcn 补位，不再使用 ai-elements）。
- DESIGN.md 落地：主题 CSS（beUI token 名 + GitHub Light/Dark 取值）、`text-ui-*` 的 Tailwind 定义与 `--ui-font-size`、beUI 组件拷入时的字号与文案改写方式，以及可否用 lint 检查禁用的字号类。
- 桌面端前置的 Agent Core 改动：`Session already open` 改为带 code 的 user-visible error（含 zh/en），`list()` 按目录容错；是否持久化 Background Job pgid 并在打开时回收孤儿进程组。
- 打包细节：universal 还是分架构构建；sidecar entitlements 沿用 Helper 还是 `afterSign` 单独重签；发布检查如何验证 JIT 生效；真实签名、公证与 Windows 签名的验证方式。
- 编译产物中 `rg` 的查找方式由 Agent Core 与 npm 分发共用，需与 `.scratch/npm-release/` 02/03 协调归属与顺序。
- Electron `app://rukie` 自定义 scheme 的文件服务方式（实验中 `loadURL` 报 `ERR_FAILED (-2)`），以及在锁定的 Electron 41.0.3 上复核 Origin 行为。
- beUI 组件的引入方式：拷入源码后的 i18n 改造、Markdown 接入点、shiki 语言扩展，以及 tech-stack 依赖更新。

## Out of scope

- Web 产品（远程访问、部署、多用户认证）：以后另开 effort 复用 `packages/ui`。
- Agent Core 迁移到 Effect：与 ADR-0024 大面积交叉，另开 effort。
- MVP 之外的 TUI 对等能力（Plan Mode、Rewind、Background Jobs 视图、MCP 面板、Goal、slash commands 等）与桌面设置界面。
