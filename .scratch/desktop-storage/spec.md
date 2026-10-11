Status: resolved

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

| 画板      | 流程与合同                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| P01 / C10 | 模型服务总览，供应商列表与详情，添加供应商入口；保留已有聊天布局                                                                 |
| P02 / C13 | 添加供应商目录，选择目录项或创建自定义供应商；目录是模板来源，不自动发现终端账号；返回箭头回到详情，新建供应商立即出现在左侧     |
| P03 / C11 | 新供应商、模型空状态；录入名称、Base URL、API 格式、遮罩 API Key；没有模型时显示空状态                                           |
| P04 / C14 | API 格式：Anthropic Messages、Chat Completions、Responses；明确路由与 Base URL 拼接，匹配已锁定模型适配器                        |
| P05 / C16 | 添加/编辑模型：模型 ID、上下文窗口、最大输出 Token、智能配置、高级配置、输入类型、模型能力、推理等级与参数映射、重置、取消、保存 |
| P06 / C12 | 已配置模型行显示模型 ID、上下文和能力徽标，支持连接验证、编辑、删除与启用；编辑复用 P05，启用且可认证的模型进入聊天目录          |
| P07 / C15 | 供应商操作菜单：重命名、删除                                                                                                     |
| P08 / C17 | 删除供应商确认，取消不修改持久化数据，确认原子移除配置和密文；历史 Transcript 保留                                               |

画板中的供应商、模型 ID、URL 和能力徽标是示例，不硬编码为真实可用目录。C16 的视频、PDF、结构化输出、原生联网、对话中系统消息、推理参数映射必须核对 pi-ai 的真实输入和协议能力；不能把不支持的字段显示为已可用，也不能为满足画板静默丢弃保存字段。票据 05 先核对智能配置与高级字段的实际合同，再实施完整模型服务流程，发现需要产品取舍的能力缺口须显式提出。连接验证使用该流程的配置状态反馈，不替换为另一套简化录入向导。

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
