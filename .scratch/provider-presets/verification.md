# Provider presets 验证记录

本记录汇总可移交证据；实施票记录对应状态与增量结果。所有模型请求使用 fake fetch 或隔离 loopback 供应商；GUI 使用 Chromium 和 memory 加密；桌面原生边界使用 Electron mock。未使用真实 Key、Electron 应用或用户配置。

## 01–05 已通过证据

| 范围                                                 | 证据                                                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Model Service 合同、持久化、目录过滤、移除 templates | 46 Bun 用例通过；追加持久化用例通过；16 store/host 用例通过；preload mock 用例通过                                                      |
| ProviderIcon                                         | 三处图标与 composer Chromium 3 用例通过；冻结安装 887 包且无 antd/@lobehub/ui 实体；Vite 构建通过                                       |
| DeepSeek 预设                                        | schema 1 用例通过；三种协议/模型 × automatic/high 共 10 payload 用例通过                                                                |
| 设置布局                                             | 38 个设置/shell/layout Chromium 用例通过；加强后的 2 个几何用例通过，宽窄屏及 Light/Dark；C11 列表 291px、控件 32px、间距 4px、圆角 8px |
| 目录与自动保存                                       | 28 Chromium 用例通过；后续目录/协议、500ms 时钟/关闭 flush、串行写/失败/几何用例增量通过；固定 Key 链接 Electron mock 12 用例通过       |

## 最终集成

2026-10-13，a6ce7041 加票 06 文档修正，冻结安装成功（887 包，1.90s）。仓库级 `install.peer = false` 可能影响多个包的实际依赖，并且集成了自动保存与原生 mock 消费者，因此在隔离临时 HOME、Bun 1.4.2、Node 26.10.0 下执行一次 `env -u NO_COLOR bun run check`。

该 aggregate 实际失败：退出 2，11.97s。docs:update（147 Markdown 文件）、全仓格式（1337 文件）与 lint 通过；tsc 在新增 payload 测试报告 Request 重载和 native ThinkingLevel 两项错误，Bun/desktop 尚未运行。失败记录保留；新的修复代理负责源码与 scoped 复验，票 06 只继续尚未执行的门禁，不重跑 aggregate。

评审修复 e9aa0ae5 已集成，四个评审问题和 payload 类型问题经新的修复代理定向验证；完整与受影响 tsc、修复文件 lint/format 通过，证据复用。票 06 补执行 Knip、scratch、docs、ink 边界、test-policy、ui-typography，全部通过。

`bun run test` 实际失败：3507 通过、25 失败，3532 用例 / 337 文件，167.46s。19 个发布测试被本机 npm 11.19.1 的版本要求拒绝；另外模型状态两例、TUI 模型选择两例、混合任务视口一例、UI lint 边界一例在最小范围复现。独立冻结安装的 origin/main 03942c37 复现模型状态两例、TUI 选择两例、lint 一例和代表性的 npm 版本拒绝；混合任务用例在基线单次通过、当前单次失败，仍未分类，不能宣称全部 25 项为既有失败。对应生产与测试文件未被本 spec 修改。失败没有被后续定向通过替代，也未重复全套。

`bun run test:desktop` 在隔离 HOME 中找不到已有 Chromium，启动失败（1.46s），其中 14 个 Node 文件 / 50 用例通过。以 `PLAYWRIGHT_BROWSERS_PATH` 指向已有浏览器缓存，不触碰用户配置；根 project 筛选曾因未找到嵌套项目启动失败（0.22s，无用例），纠正为 packages/ui cwd 的 `bunx --no vitest run --project ui-browser` 后，17 文件 / 100 用例为 99 通过、1 失败（25.32s）。失败来自 host 测试仍点击已删除的 Save provider，已交由新的修复代理更新公开自动保存等待；其余证据保留。

新的修复代理提交 c69affe8 更新 host 测试消费者，公开 sidecar 状态等待用例 1 通过，其格式、lint 和 hooks 通过。复用 99 浏览器与 50 Node 用例，共 150 个桌面用例覆盖通过；这是包结果加受影响增量结果的组合证据，不称为重新运行整套绿色。

GUI 于 c69affe8 完成一次 `bun run dev:desktop:web --isolated` + agent-browser 命名 Chromium 会话。1887×1210 和 420×1210 的 Light/Dark 已检查目录、DeepSeek/DeepSeek 2 和自定义服务创建、三协议联动、fabricated Key 防抖保存、无效 URL 的切换 flush、无模型服务开关、停用/重新启用后的模型目录与状态、列表/详情/模型选择器品牌图标、模型弹窗 32px/8px 几何、Tab 可见焦点与 Enter 创建、输入 text 光标、获取链接 pointer、禁用选项不激活及无水平溢出。console 只有 Vite 连接和 React DevTools 信息，无运行错误；资源请求均成功，无外部提供方请求。截图在交付时的外部证据目录，关键文件名为 06-catalog-light.png、06-catalog-dark.png、06-provider-light.png、06-provider-dark.png、06-model-dark.png、06-picker-dark.png、06-provider-narrow-light.png、06-provider-narrow-dark.png。关闭浏览器并停止 launcher，确认所属进程退出且临时 rukie-web-isolated 目录清除；未启动真实 Electron 或系统凭据操作。

## ADR Coverage 与未验证项目

已核对 CONTEXT、ADR-0038、ADR-0037、DESIGN 与 tech-stack，修复 DESIGN 中残留 custom-only 目录描述。spec 补充仓库级 peer 安装策略与固定原生 Key 链接的 ADR-0038 归属；预设无执行关联、templates 删除与原有存储/信任合同一致。

真实 DeepSeek 三协议 × automatic/high 的工具调用和两轮对话，以及正式 Electron 系统浏览器派发，仍待用户验收，具体清单见 [spec](spec.md#待用户用真实-key-验收)。功能范围内的定向验证、静态检查和 GUI 已完成，四个评审问题已修复；完整 Bun 仍失败且混合 TUI 原因未确定，最新 PR CI 待验收，不能宣称全量接受或可合并。

## 25 项失败修复与最终接受（2026-10-13）

本节记录用户要求在 `feat/provider-presets` 修复前述 25 项失败的结果；上文 3507 通过、25 失败及混合 TUI 当时未分类的事实保留。最终被测状态为该分支 `99b76a46c2315a04b76b5c3f19e568d61a485045`，工作区干净，所有修复由新的子代理执行，未复用执行代理。

| 原失败范围        | 根因与修复                                                                                                                                                                              | 定向验证                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 发布 19 项        | 宿主 npm 11.19.1 不满足生产版本合同；测试使用精确锁定的真实 npm 11.21.0 CLI，经既有入口注入。生产版本、OIDC、安全和注册表合同保留。                                                     | publication/recovery 20 项通过，72 断言，114.00s；包含 npm 12.1 拒绝与真实 loopback 上传、安装、Session 验收。 |
| 模型状态 2 项     | 当前 Session 已初始化 v2，旧 fixture 未真正提供 v1；拒绝切换后初始镜像也不应为空。通过原生 Harness 先写入真实 v1，再验证公开 resume 和实际请求；拒绝场景精确保留初始模型与设置。        | 两项通过，16 断言，250ms；评审后的 lease 清理修正另验 v1 resume 一项通过，4 断言，200ms。                      |
| TUI 模型选择 2 项 | 聊天目录没有使用已注入 Models，fixture 又混入内置注册表和宿主凭据发现。目录转发已有注入；fixture 使用显式模型和 SDK key auth，Loading 使用可控 auth barrier，选择后检查实际模型请求。   | 八个共享消费者文件共 53 项通过，227 断言，7.40s；新改模型选择用例均小于一秒。                                  |
| 混合 TUI 1 项     | 已显示分支跳过终端 frame 等待，点击坐标来自尚未结算的绘制帧。推导坐标前统一等待有界可见谓词，使终端写入和点击命中几何一致；保留阅读、复制、resize、Jobs/Subagents 与 Interaction 断言。 | 原失败 4.39s；最终无探针用例通过，27 断言，2.70s，保留真实子进程和 durable Reporter 成本。                     |
| UI lint 边界 1 项 | host→client 组合已被 ADR-0037 允许，旧负例过时。改为允许该组合，同时增加七个真实禁止的 host 依赖负例；lint 策略保持原样。                                                               | 一项通过，32 断言，421ms。                                                                                     |

Standards 与 Spec 使用两个新的只读评审代理。Spec 无发现；Standards 唯一 P2 为 v1 fixture 在 Harness 初始化或关闭失败时未必释放 lease，已由新的修复代理通过外层 lease 与内层 Harness `try/finally` 修复，并完成定向验证和结构复核。没有删除断言、增加重试、固定等待、放宽超时或修改生产兼容策略；调试探针已删除，terminal renderer 没有变更。

最终在原 `feat/provider-presets` 仓库根目录执行 `bun install --frozen-lockfile`，退出 0，安装精确锁定 npm 11.21.0 的一个包，111ms，tracked tree 未改变。Bun 1.4.2、Node 26.10.0，宿主 npm 11.19.1 未升级。共享模型/auth fixture、Frontend Models 注入及真实 npm CLI 影响多个测试消费者和安装入口，且四组修复尚未共同验证，因此执行一次 `env -u NO_COLOR bun run check`；使用新建临时 HOME，`PLAYWRIGHT_BROWSERS_PATH` 指向已有 Chromium 缓存，不接触真实凭据、Session 或 Electron。

| 最终门禁                                                                                | 实际结果                                                                                           |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| docs:update、格式、lint、tsc、Knip、scratch、docs、ink 边界、test-policy、ui-typography | 全部通过；格式覆盖 1338 文件，docs 覆盖 147 Markdown 文件。                                        |
| Bun 全量                                                                                | 3532 通过、0 失败，337 文件，21473 断言，215.82s。                                                 |
| desktop 全包                                                                            | 31 文件、150 用例全部通过，25.52s；Node 执行 Vitest，Chromium browser mode 与 Electron mock 边界。 |
| 完整 aggregate                                                                          | 退出 0，总耗时 255.49s；所属进程退出后删除临时 HOME。                                              |

完整日志及精确环境由本次外部证据目录的 `final-check.log`、`final-check-result.json` 和修复 `verification.md` 保存。上述接受覆盖此前全部 25 项失败，不能抹去旧的失败结果；文档收尾、只读评审及提交不改变已验证源码，沿用本次证据，不再次执行全量检查。

本次没有 React DOM、样式或 browser client wiring 变更，复用既有 Light/Dark、宽窄屏 GUI 验收；TUI 通过公开终端消费者、混合场景和本次全量验证接受。真实 DeepSeek Key 与正式 Electron 手动清单仍未验证。修复只在现有分支交付并沿用 PR #19；本地完整检查通过，修复提交的 CI 尚待推送后验收，未合并 main。
