Status: claimed

# Spec: 桌面端独立 SQLite 存储与模型服务录入

## Problem Statement

已交付的[桌面 MVP](../desktop/spec.md) 使用终端的 JSONL Session、配置与供应商环境凭证。桌面端需要独立管理会话、项目、置顶、配置与加密凭证，工具完整输出存入数据库。用户已于 2026-10-11 确认全部设计分叉，并指定供应商录入采用 `rukie.pen` 的模型服务流程。01–06 的首轮实施与验收记录保留；启动钥匙串提示和设置页设计还原已完成纠正复验，实际证据与限制见下文。

## Solution

权威决定为 [ADR-0035](../../docs/adr/0035-desktop-isolated-sqlite-storage.md)。Electron main 确定独立数据根并负责 safeStorage，Bun sidecar 独占业务 SQLite 写入；Core 的存储、配置与输出能力通过注入接缝复用，TUI/Headless 默认路径不变。

```text
<app userData>/data/
  app.sqlite
  sessions/<id>/session.sqlite
  attachments/
  file-history/
  workspace/
  rules/
  skills/
  agents/
```

布局为当前实现路径。WAL/SHM 和执行 lease 属于所属数据库的资源，不作为另一套持久化事实。API Key、OAuth token/client_secret、授权临时秘密与 MCP header 认证秘密仅以密文落盘；图片等附件及恢复文件历史单独存文件。桌面用户级 MCP、hooks、权限和项目信任存 app.sqlite，规则/skills/agents 内容由同一数据根内的文件承载。

## Implementation Decisions

- 独立数据根与真实 OS home 分离；禁止通过替换 homeDir 改变 `~/` 的工具及权限含义。桌面不扫描 OS home 的用户配置、规则、skills、agents、MCP、凭证、缓存、Session 或文件历史。
- 项目级输入继续遵守现有信任规则，项目不能定义供应商凭证。工具正常继承系统环境，供应商认证不读取终端 API Key，桌面凭证不自动注入工具环境。
- 应用索引/配置一库，每独立根 Session/Harness 一库；子代理继续在根 Harness 内保存 Conversation 与任务 ownership；沿用 pi-durable 原生事务、documents/tasks/Transcript 和恢复，不增加第二套调度或重放。
- WAL + FULL；分块输出仅承诺已提交内容。所有 Bash、后台 Job 和截断前完整输出入库，原有字节游标、模型截断和中断语义不变；去除桌面输出的临时日志路径权威引用，持久化失败不能表现为执行成功。
- 相对文件引用限制在数据根，保留历史分支引用；异常写入与孤立文件清理可重复执行。仅声明完整备份范围，不新增备份 UI。
- 当前读入口包括 `createSession`、`listSessions`、`readSessionStorage`/只读 snapshot、子代理、恢复与清理，必须全部选择相同后端，busy 只读不能取得执行权。
- Electron 单实例和 Session 执行 lease 分别验证；SQLite WAL 不等于跨进程执行独占。退出排空输出、关闭 Session 与数据库，重启恢复已提交状态。
- 不导入或迁移旧桌面/TUI 数据，不回退共享目录。应用配置、供应商和模型重启后保留；无凭证仍可查看历史，发送前配置有效模型。
- 配置修改影响后续采用新配置的执行；当前已开始的模型请求保留其配置快照，删除供应商不删除历史会话。会话引用不可用模型时显示重新选择要求，禁止隐式采用其他供应商。

## 模型服务录入

设计源是用户维护的 `rukie.pen`。2026-10-11 经 Pencil MCP 读取 M17（`qYVTA`）、C10–C17 和 P01–P08；记录画板标识与流程，不在仓库约束中写入个人绝对路径，也不修改设计源。

| 画板      | 流程与合同                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| P01 / C10 | 模型服务总览，供应商列表与详情，添加供应商入口；保留已有聊天布局                                                             |
| P02 / C13 | 添加供应商目录，选择目录项或创建自定义供应商；目录是模板来源，不自动发现终端账号；返回箭头回到详情，新建供应商立即出现在左侧 |
| P03 / C11 | 新供应商、模型空状态；录入名称、Base URL、API 格式、遮罩 API Key；没有模型时显示空状态                                       |
| P04 / C14 | API 格式：Anthropic Messages、Chat Completions、Responses；明确路由与 Base URL 拼接，匹配已锁定模型适配器                    |
| P05 / C16 | 添加/编辑模型：模型 ID、显示名称、上下文窗口、推理能力/层级、输入类型、高级设置（自动压缩、运行参数、价格）、取消、保存      |
| P06 / C12 | 已配置模型行显示模型 ID、上下文和能力徽标，支持连接验证、编辑、删除与启用；编辑复用 P05，启用且可认证的模型进入聊天目录      |
| P07 / C15 | 供应商操作菜单：重命名、删除                                                                                                 |
| P08 / C17 | 删除供应商确认，取消不修改持久化数据，确认原子移除配置和密文；历史 Transcript 保留                                           |

画板中的供应商、模型 ID、URL 和能力徽标是示例，不硬编码为真实可用目录。当前 C16 以最新用户严格复原要求为准，覆盖早期票据 05 的智能配置、额外能力、协议映射编辑和重置的呈现要求；高级设置只展示设计稿的字段。不能把不支持的字段显示为已可用，不能静默丢弃模型已有兼容字段与推理参数映射。连接验证使用该流程的配置状态反馈，不替换为另一套简化录入向导。

API Key 录入通过受信任 preload IPC 到 main，再经私有 main/sidecar 通道保存密文；会话 WS 只传脱敏模型目录和非敏感状态。renderer 不取回已有明文、不拥有解密能力。加密不可用、授权取消、解密失败保持数据完整并展示重试/重新配置，不明文回退。数据库写失败保留表单输入且不报告保存成功，取消不覆盖已有配置。正常启动、模型目录和历史浏览不解密供应商、hooks、MCP/OAuth 秘密，不打开未加载的 Session 执行路径；未使用 Cookie 不访问钥匙串。用户显式执行或凭证操作时允许真实系统授权提示。

本轮仅实现模型服务设置，画板设置导航里的其他设置分类不因此成为已授权功能；沿用共享导航结构，只开放有对应能力的入口。

浏览器开发模式使用隔离数据根与脚本化非生产凭证实现，不调用真实账号或模拟生产加密验收成功。打包 macOS 验收使用实际 safeStorage 和正常启动参数。

## Implementation Tickets

| 票据                                                      | 依赖           | 内容                                  |
| --------------------------------------------------------- | -------------- | ------------------------------------- |
| [01](issues/01-desktop-data-root-and-config-isolation.md) | 无             | 数据根、用户级配置与真实 home 分离    |
| [02](issues/02-native-sqlite-session-store.md)            | 01             | 原生 SQLite store、单写者与所有读入口 |
| [03](issues/03-app-database-and-secret-storage.md)        | 01             | 应用数据库、索引与 safeStorage 密文   |
| [04](issues/04-tool-output-database-storage.md)           | 02             | 完整工具/Job 输出分块入库             |
| [05](issues/05-model-services-pencil-flow.md)             | 03             | rukie.pen 模型服务流程与认证接线      |
| [06](issues/06-integration-and-packaged-acceptance.md)    | 02, 03, 04, 05 | 集成、恢复、隔离及真实打包验收        |

## Acceptance Criteria

- 旧 TUI 配置中放入哨兵供应商、信任和 Session；桌面不列举、不认证、不采用这些规则，不写旧目录。相同项目的 TUI 与桌面同时运行各自 Session，互不争抢执行 lease。
- 用真实 Session/fake model 验证新建、流式、工具输出、abort、resume、排队、子代理与只读 busy snapshot。超过当前内存截断阈值的完整输出重启后仍可按游标读取，恢复不重跑非 safe 外部副作用。
- 应用索引和各 Session 库跨重启一致；建库/索引之间崩溃或失败不会隐藏可发现已提交 Session，不扫描旧目录或启动恢复执行。FULL/WAL 配置和单写者隔离可观察验证。
- 真实 macOS safeStorage 的录入、遮罩、重启认证、替换、删除、失败/取消行为通过；测试与日志不输出真实密钥，会话网络没有明文凭证。
- P01–P08 流程与可用模型目录一致，保存失败、输入取消、缺失模型和配置被删除可操作；zh/en、键盘/焦点、Light/Dark、窄窗口按 DESIGN.md 验收。
- TUI/Headless 的既有 JSONL、配置读取和完整工具输出行为不变；附件与文件历史引用可恢复，应用退出后无本轮启动的遗留进程或数据库连接。

## ADR Coverage

| 决定                           | 归属                                                                                                                                         | 理由                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 独立数据根、SQLite、输出与凭证 | 新增 [ADR-0035](../../docs/adr/0035-desktop-isolated-sqlite-storage.md)                                                                      | 替代共享持久化，明确事务、隔离与资源所有权                     |
| 原生恢复和重放                 | 沿用 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)                                                                             | 更换后端不更换执行语义                                         |
| MCP 生命周期                   | 部分替代并沿用 [ADR-0019](../../docs/adr/0019-mcp-oauth-credential-ownership.md)                                                             | 改密文落盘，保留身份、授权和项目信任                           |
| Cookie 与钥匙串                | 沿用 [ADR-0034](../../docs/adr/0034-desktop-cookie-free-startup.md)，更新 [ADR-0035](../../docs/adr/0035-desktop-isolated-sqlite-storage.md) | 禁用未使用 Cookie；目录/历史只读不解密，显式执行保留系统加解密 |
| UI、server、desktop 所有权     | 沿用 [ADR-0029](../../docs/adr/0029-desktop-package-structure.md)                                                                            | main 管宿主加密，server 组合，Core 拥有执行                    |
| 模型服务布局与组件             | 无需额外 ADR                                                                                                                                 | 用户指定既有画板流程，遵守 DESIGN.md；协议缺口由实施调查核实   |

## Delivery Evidence

设计访谈已完成，所有存储分叉经用户确认。领域复核保留 CONTEXT.md 的 Session、Transcript、Run、Turn、Interaction、Model Selection 含义；SQLite、应用数据根和凭证密文属于实现选择，不为它们新增领域术语。原 MVP resolved 记录保留历史交付证据，新功能状态按本规格 01–06 更新，不把文档确认当作实现完成。

文档交付检查：`bun run docs:update`、`bun run check:docs`、`bun run check:scratch`、修改文件的 `oxfmt --check` 与 `git diff --check` 通过。只读事实复核补齐 OAuth client_secret/认证 header 的加密范围，以及只读 SQLite 不得触发 schema migration。未运行行为测试或生产加密验收；六张实施票保持 ready-for-agent。

实施集成记录（2026-10-11）：每张票使用独立的新 implementer 子代理，依赖顺序集成至 `feat/desktop-storage`；运行代码候选 `4d3cf021`，统一文档评审修复与 06 最新证据合入 `d4de7b37`。Standards 发现的 CONTEXT 存储说明与 ADR 替代链已修正；Spec 评审未发现代码缺陷。ADR Coverage 复核确认独立数据根、原生 Harness、输出/文件引用、加密通道与宿主生命周期分别由表中 ADR 覆盖，领域含义不变；协议适配器不支持的视频、PDF、结构化输出和原生联网在模型设置中明确禁用说明，不宣称可用。

根集成验证：受影响 Core/server 29 pass，1.87s；`bun run test:desktop` 25 文件 92 pass，8.98s；浏览器 Light/Dark、窄窗口、历史完整输出和显式重选后续发送通过。一次 `env -u NO_COLOR bun run check` 静态阶段通过，Bun 3429 pass、21 fail，165.53s，未进入 desktop 阶段。19 项发布失败受本机 npm 11.19.1 门槛阻止，最小 publication 用例同样报要求 11.21.0 或受支持的 OIDC 版本；发布脚本无本轮 diff。两个 TUI 模型面板用例受继承的 `DEEPSEEK_API_KEY` 增加页签影响：当前与基线 `a447d45f` 均 3 pass/2 fail，单独移除该变量后均 5 pass（568ms），相关测试/模型路径无本轮 diff。这些既有环境失败不扩展为本轮修复范围，全量结果仍为失败。签名 arm64 包来自 clean `4d3cf021`，打包完整性检查通过；真实 safeStorage 录入、重启认证、替换、删除及失败/取消尚未验收，原生 UI 报告 Mac 锁定，需要人工解锁。PR 保持 draft，工单/spec 不关闭。

使用临时 npm 11.21.0（不修改系统 npm）复验 publication/recovery 两文件：20 pass、0 fail，114.27s。原 aggregate 的 19 项发布失败确认为环境版本门槛；聚焦复验不改写原 aggregate 结果。六张票和统一评审修复的临时工作树及已合入分支已清理，最终签名包和外部验收证据保留。

最终关闭（2026-10-11）：用户解锁后，来自 clean `4d3cf021` 的真实签名 arm64 包通过正常启动、真实 safeStorage 保存/遮罩/重启解密认证/替换/删除、表单取消、错误凭证反馈、仅破坏隔离测试密文后的真实解密失败及修复。删除供应商并完整重启后历史完整输出可分页读取，明确重选模型后同一 Session 可继续发送。四次 Cmd-Q 正常退出、第二实例退出、浏览器和测试 API 清理、SQLite 完整性及零凭证残留均通过。没有出现 OS 钥匙串授权提示，不声称测试其取消；加密不可用和授权取消分支另有 unit 证据。原 aggregate 失败保持原记录，临时 npm 与隔离环境的聚焦复验通过；代码候选 CI 已通过，最终关闭文档提交的 CI 待观察。ADR Coverage 经独立评审与最终实现核对完成，所有六票与 spec 在同一变更中 resolved，PR 交付等待用户评审，未授权合并 main。

## Corrective follow-up

2026-10-11 用户报告每次启动出现钥匙串/密码授权窗口，以及设置页未严格还原 Pencil。重新打开 03、05、06 与 spec，分别由新的子代理诊断启动凭证访问并对照实际画板修正设置布局/样式；历史验收记录保留，最终关闭需完成本轮回归与原生/浏览器验收。

本轮纠正集成至 `bf1c434f`：启动路径 `402fbe5a` 将展示配置与执行配置分离，未加载历史使用已提交 snapshot；busy 仅即时探测独立 mutex，不取得执行 lease。设置恢复 `03fe8f40` 严格对照 P01–P08，DESIGN.md 先记录设置范围的画板色板/字体，聊天布局与字体保持。独立 Standards/Spec 发现 Cancel Enter 误删、模板目录缺失、能力说明不可发现与测试资源清理不足；新统一 implementer 在 `6c34274c` 修复，复评均无新增发现。

根 desktop 初次纠正复验为 96 pass/1 fail（10.77s），Transcript 向上阅读用例在聚焦运行通过，未把聚焦通过当作全套通过。新诊断代理在候选与 `03fe8f40` 基线均证明旧 readiness 判定能在顶部虚拟行提交前接受；另一个受控定位回调能覆盖直接设置的 scrollTop。未声称复现原始 16721 的完整时序。`bf1c434f` 仅增加七行等待公开内容/虚拟行/离屏更新预览的测试条件，保留精确滚动断言；相关 25 pass（9.10s），根静态检查和一次有因的 desktop 全套复验 97 pass（10.49s）。新平行 Standards/Spec 复评通过，生产代码与构建输入仍等于 clean `6c34274c`。此阶段实际签名包验收仍在进行，03/05/06 与 spec 保持 claimed。

纠正复验关闭（2026-10-11）：clean `6c34274c` 真实签名 arm64 包通过两次真实密文配置启动、历史/目录/完整输出分页，未出现 OS 授权提示且无隐式配置请求；显式执行真实解密、认证与历史继续发送通过，键盘取消/确认、Light/Dark/窄屏、离线字体及退出/隔离数据清理完成。详细原生事实、构建/最终测试版本区别、未覆盖分支和初次 helper 缓存隔离偏差统一记录在 [06](issues/06-integration-and-packaged-acceptance.md)，不将先前失败或未覆盖行为算作通过。

最终 ADR Coverage 对照 Implementation Decisions、最终 diff、独立评审与原生事实复核完成；展示配置与执行秘密分离及即时 busy 探测归更新后的 ADR-0035，原生 Harness、输出/附件/文件历史、加密身份和生命周期继续由已有 ADR 覆盖，设置样式/测试就绪修复无需新 ADR，领域含义不变。03/05/06 与 spec 在同一变更中 resolved；最终推送后的 CI 待观察，PR 等待用户评审，未授权合并 main。

用户截图补充（2026-10-11）：重复测试密码提示来自独立验收 helper 访问正式应用同名钥匙串；普通 desktop 自动测试使用 mock 加密，不触发此路径。helper 已停用且当前无进程，未改钥匙串权限/用户凭据；正式应用启动与 helper 准备过程的证据分开记录，详见 [06](issues/06-integration-and-packaged-acceptance.md)。

## P01–P08 供应商界面更新

2026-10-11 用户明确授权更新供应商页面及添加模型弹窗布局，按当前 rukie.pen P01–P08 和组件复原；添加供应商仅保留自定义入口，不展示预设供应商。滚动区域采用设计源的 A13 自定义滚动条，浏览器验收包含 Light/Dark、窄屏和实际滚动交互，保留聊天布局。补充工作由 [07](issues/07-provider-pencil-refresh.md) 的新子代理实现，覆盖此前添加全部预设目录的要求。普通自动测试与浏览器 mock 验收按当前测试授权边界执行，不启动真实 Electron。

本次局部供应商呈现/组件样式调整无需新 ADR：不改变存储、凭据、Session、协议或包依赖方向。最终关闭前核对实际 diff 与现有 ADR-0029/0035，记录组件来源、布局基线及本地验证。

07 最终关闭：供应商仅自定义入口、最新 P01–P08 供应商/模型弹窗布局与 A13 覆盖式滚动条实现并完成评审修复；组件来源和几何更新归 DESIGN.md，所有配置/凭据合同保持既有边界。实际 footer 与 Light hover 缺陷已最小 red/green 修复，最终 Chromium/mock Light/Dark/窄屏/键盘/拖拽验收完成。root `1c6672f2` 的 desktop 100 pass（11.21s）及 check:dev 全通过，独立复评无遗留问题。ADR Coverage 复核沿用 ADR-0029/0035，本轮无需新 ADR；详细证据归 [07](issues/07-provider-pencil-refresh.md)。07/spec 同时 resolved，按用户要求以本地结果交付，不等待 CI，未启动真实 Electron，未授权合并 main。

## API 下拉框样式回归

用户本机浏览器预览截图显示 API 格式下拉框出现列表圆点、异常行高与不匹配的悬停色。由 [08](issues/08-provider-api-dropdown-style.md) 的新代理从实际预览入口复现，继续采用已有 beUI Select，核对 P04/C14 展开几何与 Light/Dark 色板，并补上公开 DOM 样式回归。用户当前预览入口与进程保留，不通过启动真实 Electron 验证。

08 本地交付完成：`5f36dfca` 保留 beUI 并修复列表结构、Pencil 展开几何和局部 hover；desktop 102 pass（11.83s）及 check:dev 通过，实际 Chromium/mock Light/Dark/窄屏/键盘验收完成。独立评审要求的 hover 覆盖与异常清理由两个新代理分别在 `86893fec`、`a6f2f0bd` 修复；最后仅两例复验 2 pass（1.93s），生产源码未变，复用此前整套及浏览器证据。具体失败、警告与复核记录归 [08](issues/08-provider-api-dropdown-style.md)。ADR Coverage 沿用 ADR-0029/0035，本轮局部 DOM/样式/测试无需新 ADR，不等待 CI，未启动真实 Electron。

用户随后指出高级配置包含当前 C16 不存在的表单，作为独立后续工作推进；本规格保持 claimed，08 已 resolved。

## 当前 C16 高级设置纠正

[09](issues/09-model-advanced-pencil-fields.md) 在 `817c3bbf` 移除设计源不存在的智能配置、额外能力/兼容、JSON 映射和重置入口，并同步高级设置标题、摘要和卡片几何。设计中的自动压缩、运行参数和价格九项字段保留；编辑保存沿用原模型的 compat/thinkingLevelMap，不改变宿主、持久化 schema 或凭据合同。最新用户要求覆盖历史 05 中这些额外表单的呈现要求。

受影响 ModelServices 文件 13 pass（10.79s），之后几何和推理开关修正只补跑单例 1 pass（1.27s）；静态检查通过，实际 Chromium/mock Light/Dark/420px 的高级区域验证完成。最终仅更新 4px 宽度修正影响的截图，根集成复用证据，不再重复整套测试、静态或完整浏览器流程，未启动 Electron。独立 Standards/Spec 的唯一过时文档发现已删除；父代理核对最终差异、断言与截图关闭发现。ADR Coverage 沿用 ADR-0029/0035，局部表单和冗余 UI 状态清理无需新 ADR。09/spec 同步 resolved，以本地结果交付，不等待 CI，PR 等待用户评审，未授权合并 main。

## 模型默认推理等级

用户确认补齐默认等级选择、保存和采用模型时生效，由 [10](issues/10-model-default-reasoning.md) 的新实施代理完成；模型设置使用既有 beUI Select，桌面模型默认值不替换会话已明确选择或恢复的推理等级。09 历史关闭证据保留，spec 为本票重新 claimed。验证遵守更新后的 docs/testing.md：由实施代理记录，父代理复用；未涉及原生合同，不启动 Electron。

10 本地完成于 `d3defa71`：桌面元数据保存与采用模型接线、显式等级优先、恢复保留选择均有 focused 证据；独立两轴复核 0，实际 Light/Dark/窄屏默认菜单、保存重开及局部尺寸修正验收通过。集成复用实施代理的测试/静态/截图，只检查 FF/祖先和差异，不重复执行。ADR Coverage 沿用 ADR-0029/0035，无新增架构取舍；详细实际失败与结果见 [10](issues/10-model-default-reasoning.md)。

数字输入框仍使用 beUI Input，但其内部 number 输入的原生按钮未适配 Pencil，由 [11](issues/11-number-input-pencil-style.md) 的新代理仅修正模型弹窗样式。10 resolved，spec 为 11 保持 claimed。
