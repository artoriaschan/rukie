# @rukie/server

Bun 本机 Frontend 通过带鉴权的 WebSocket 驱动 Agent Core。Session 使用应用数据根中各自独立的 SQLite store，应用索引、项目、置顶、归档、偏好与模型配置由本包的 `app.sqlite` 维护；与终端的用户配置和 Session 隔离。

## 使用

从包入口调用 `startServer({ homeDir, dataRoot })`，等待返回 `{ port, token, close }`。启动默认向 stdout 写一行 JSON `{port, token}`；诊断写 stderr。调用方负责在退出时等待 `close()`，释放 Run、Session lease 和 Background Job。`homeDir` 是工具与权限展开 `~/` 的真实 home，`dataRoot` 必须是显式绝对路径，不回退共享目录。进程入口 [src/main.ts](src/main.ts) 从私有启动环境 `RUKIE_DESKTOP_DATA_ROOT` 与 `RUKIE_DESKTOP_HOME_DIR` 接收这两个值，并处理 SIGTERM 和 SIGINT。浏览器开发模式也必须显式设置隔离的 `RUKIE_DESKTOP_DATA_ROOT`。`RUKIE_DESKTOP_CONFIGURATION_ROOT` 可指定独立共享配置根；缺省时配置跟随数据根。

进程入口必须通过 `RUKIE_DESKTOP_ENCRYPTION_BACKEND` 显式选择 `electron`、`system-keychain` 或 `memory`，未选择、未知值或必要参数缺失时在握手前启动失败，不探测或回退。`electron` 要求 `RUKIE_DESKTOP_SECRET_URL` 与 `RUKIE_DESKTOP_SECRET_TOKEN` 指向 main 的私有加密通道；`system-keychain` 要求非空 `RUKIE_DESKTOP_SECRET_SERVICE` 系统凭据服务名；`memory` 不需附加参数，仅用于隔离验收。`RUKIE_DESKTOP_MANAGEMENT_TOKEN` 供 main 的私有管理通道使用。所有 `RUKIE_DESKTOP_*` 启动变量在捕获后从进程环境删除，工具子进程只继承正常系统环境。

`system-keychain` 经 `Bun.secrets` 首次加密时创建一把 AES-256-GCM 主密钥，后续进程从相同 service 的 `credential-master-key-v1` 项读取；读取失败、授权取消、已有主密钥无效或解密缺少主密钥均返回可重试凭证错误，不覆盖密钥或改用其他后端。首次创建在有效配置根（`RUKIE_DESKTOP_CONFIGURATION_ROOT`，未指定时为数据根）内按 service 派生的 SQLite guard 下重新读取并写入；同一 service 的启动方必须共享该配置根。guard 不保存密钥材料，等待锁最多 15 秒，进程退出时由 SQLite 释放锁，不按时间删除其他实例的锁。密文通过认证附加数据绑定 vault 凭证身份。`memory` 主密钥只保留在当前进程，退出后原密文失效。不同后端的密文不互通，调用方必须使用独立配置根；系统凭据验收边界见 [ADR-0037](../../docs/adr/0037-browser-host-sidecar-capabilities.md)。

客户端连接 `ws://127.0.0.1:<port>/ws`，subprotocol 按顺序传入 `rukie.v1` 和 `rukie.auth.<token>`，Origin 必须是 `app://rukie`。`development: true`（进程入口的 `--dev`）额外接受 `http://localhost:5173`。随机端口绑定 loopback，鉴权失败在升级前返回 401 或 403。

## 行为与限制

[wire schema](../shared/src/wire.ts) 定义命令，`response` 关联客户端 `id`；订阅转发原始 SessionEvent，首条是 committed snapshot。新连接以 `superseded` 关闭旧连接，连接断开只移除订阅，Run 继续。`abort` 结算当前 Run，并交还尚未放入的输入。单个 Session id 的并发恢复共享一次打开操作；跨进程持有的 lease 映射为 `session_busy`。

所有 [wire schema](../shared/src/wire.ts) 命令均通过 WS 提供。`session.create` 可带 `modelSelection`（provider、modelId、thinkingLevel）与 `permissionMode`，在首条输入前应用。Agent Core 拥有执行、完成记录与 Run Summary；server 以 requestId 键控的 FiberMap 等待 `waitForRequest` 回执，完成后自动移除，不合成 Core 事件。`abort` 等待 Session 的执行与完成记录结算，回执等待者随之结束；取消不以移除 Fiber 代替 Core 结算。它返回 `{ sessionId, requestId }`，`prompt` 返回 `{ requestId }`；空闲发送立即开始 Run，运行中发送使用 Agent Core 的 Queued Input。`withdraw` 返回 `{ input }`，`steer_now` 返回 `{ status: "steered" }`，两者无法操作已放入的输入时返回 `not_queued`；`abort` 返回 `{ inputs }`，保留原文、附件与排队顺序。

`session.create { goal: true }` 以首条文本和图片调用 Core 的 `createGoal`，不再提交普通 prompt；仍返回 `{ sessionId, requestId }` 并保留 Project、工作树、模型与权限选择。已有会话使用 `session.goal_create { sessionId, text, images? }`，返回 Goal View 与 `requestId`。两个 Goal 入口都允许空文本加至少一张图片；普通新会话与 `prompt` 仍要求非空文本。图片内容沿用 Core 校验，附件只保存在首条人类消息中，不进入 Goal Tool State。

`session.goal_pause`、`session.goal_resume` 与 `session.goal_clear` 接收 `sessionId`。暂停返回 Goal View，清除返回 `{}`，均保留当前 Run 并停止后续推进；继续要求 Session 空闲，返回 Goal View 与新接收的 `requestId`。创建与继续复用普通发送的模型目录、认证准备和请求回执追踪，不切换到其他模型，也不重复提交输入。Goal 状态沿用 snapshot 的 `toolStates.goal` 和 `tool_state_changed` 转发，包括 version 2 的 `attachments`、`elapsedMs` 与推进中的 `activeSince`。只读历史保留已结算时长，展示为未 armed 且不含 `activeSince`；执行权与时间结算由 Core 拥有。Goal 的公开错误（如 `goal-busy`、`goal-exists`、`goal-missing`、`goal-complete`、`goal-round-limit`、`goal-pause-invalid`）和图片校验错误保留原错误码与安全参数，未知错误仍返回 `internal`；客户端复用通用中英文错误文案。协议边界见 [ADR-0031](../../docs/adr/0031-desktop-wire-protocol-and-local-auth.md)。

权限、问题与计划评审共用 `interaction_requested`（`sessionId`、原生 `identity`、去掉 signal 的 `request`），`request.kind` 分别为 `permission`、`question`、`plan_review`，子代理请求保留 `origin`。`interaction.reply` 带同一 `kind` 和对应的 `reply`：权限为 `allow` / `allow-session` / `deny`；问题为 `{ answers: [{ selected, custom? }] }` 或 `declined`；计划评审为 `{ kind: "approve" }`、`{ kind: "revise", feedback }` 或 `{ kind: "takeover" }`。TypeBox 校验命令结构，server 再核对请求种类、问题数量及选择标签；种类不符返回 `interaction_kind_mismatch`，不符合当前问题的答案返回 `interaction_invalid_reply`，请求保持挂起。回复核对完整 identity 和 epoch；旧回复返回 `interaction_stale`。回复、取消或会话规则覆盖都会发送 `interaction_settled`；取消的安全默认值依次为 deny、declined、takeover，不批准工具或计划。请求按创建顺序保留，订阅先收到 snapshot，再按顺序补发挂起请求；接管新连接后同样可以订阅并补发。

`session.create` 可带 `planMode`，在第一次 Run 前调用 Session 的 `setPlanMode`；`session.set_plan_mode { sessionId, on }` 在空闲或运行中切换。状态沿用 snapshot 的 `planMode` 和 `tool_state_changed { name: "plan" }`，不新增 Session state 字段；Plan Mode 独立于 Permission Mode。桌面 Session 提供 `onQuestion` 与 `onPlanReview`，因此模型可使用 `ask_user_question`、`enter_plan_mode` 与 `exit_plan_mode`；进入计划模式仍走权限询问。

`skills.list { projectId?, sessionId? }` 无需创建或恢复 Session：不传标识只列应用用户目录的技能，传 Project 标识按主目录发现，传 Session 标识按其摘要中的工作目录发现。两个标识互斥，类型或组合错误返回 `invalid_command`；不存在的标识分别返回 `project_not_found` 或 `session_not_found`。结果只包含实际生效且允许用户调用的技能，每项提供 `name`、`description`、`scope`（`user` / `project`）和绝对 `filePath`，项目同名技能覆盖用户技能。目录查询与 Session 运行都从 `dataRoot/skills` 读取用户技能；独立的 `configurationRoot` 仅选择共享配置库，不改变技能内容来源。查询只读取技能文件，不启动 Run、执行 Hook 或解密凭证。

`models.list` 读取 `app.sqlite` 中已启用的模型及凭证存在状态，不解密密钥、刷新模型或启动 OAuth。实际模型请求通过选定加密后端按供应商身份取得凭证；认证不采用终端环境 API Key。配置变更在后续发送前刷新，已开始的请求保留其供应商配置；删除选中模型或供应商后发送返回 `model_unavailable`，不会改用另一个供应商。未在当前进程打开的 Session，订阅直接读取已提交历史并返回 `{ readonly: true, modelUnavailable }`；目录与历史阅读不解密执行配置或凭证。历史 snapshot 的 `agent.thinkingLevel` 是已提交的 Thinking Level；其 `permissionMode` 是当前非敏感配置的默认值，并非历史权限事实。只有明确发送或切换模型等执行命令才打开 Session，订阅随后转为实时事件；没有可用模型或凭证时 `modelUnavailable` 为 true。已打开 Session 的订阅和状态更新还提供 `session_state`（permissionMode、thinkingLevel、contextReport），不修改原始 SessionEvent。模型切换要求 Session 空闲，权限模式对下一次工具调用生效。置顶、归档与侧栏偏好写入注册表；首次连接、Run 开始/结束、交互创建/结算和这些修改发送 `sessions_changed`，携带 `sessions`、`projects`、`pinned`、`archived`、`preferences` 与展示用 `homeDir`。`homeDir` 来自 sidecar 配置的家目录，启动时解析为真实路径（路径不存在时保留配置值），仅用于 Frontend 路径缩写，不参与目录归属或信任。Session summary 的 running 和 waitingInteraction 是侧栏状态的权威事实，覆盖未订阅的后台 Session；子代理交互回调归父 Session，等待状态同样归父会话。

Session 摘要的必填 `projectId: string | null` 读取应用数据根 `app.sqlite` 的持久绑定，`sessions.list`、初次连接、重连与 `sessions_changed` 共享该投影；没有绑定时为 `null`，不按 cwd 推测或补写既有 Session。Frontend 用它分组、显示项目标题、搜索、计数、选中及排除移动目标。创建项目 Session 与 Session Move 写入绑定，删除 Session 清除绑定；目录编辑不改变归属。

`project.create { name, directories, trusted: true }` 在调用方确认信任后创建 Project，返回 `{ id, name, directories, primary, trusted }`；目录必须存在且为绝对路径，保存时去重并取真实路径，首个目录是主目录；必填名称去除首尾空白后为 1–128 字符。所有权按精确真实路径比较，包括旧登记表保留的路径别名：主目录已登记时返回原 Project，保留原名称；其余目录重叠返回带冲突 Project 名称的 `project_conflict`。互相嵌套的不同目录允许独立登记，应用数据根及其子目录（含对话目录根 `workspace/`）返回 `project_reserved`。旧 `{ id, path, name }` 记录读取为 `directories: [path]`、`primary: path`、`trusted: false`，保留既有 Session 的 cwd，不补写绑定。

`project.update { projectId, name, directories, primary, trusted? }` 提交完整编辑状态，复用创建的名称、目录、保留路径和冲突校验，并排除自身；目录非空，主目录必须属于目录列表。已信任 Project 新增目录要求 `trusted: true`，否则返回 `project_trust_required`；未信任 Project 编辑后保持未信任。只改名、移除目录或切换主目录无需确认。`project.remove { projectId }` 先检查全部绑定 Session 的忙碌状态，任一执行中、等待 Interaction、正在打开或被其他进程占用时返回 `session_busy`；然后逐个经 `session.delete` 相同路径删除（清除置顶、归档与绑定），全部成功后移除登记并返回 `{}`。Project 文件保留；中途失败保留 Project，已删除 Session 不恢复。所有 Project 变更在同一队列中校验与持久化，成功后发布 `sessions_changed`。

`project.trust { projectId }` 在补确认后授予信任。打开 Session 时 server 按绑定 Project 派生 `additionalDirectories`（普通 Session 除 cwd 外的项目目录；工作树 Session 除 Project 主目录外的目录）与精确信任，不写回用户 settings；用户 settings 自身登记的信任仍有效。主目录切换后，下一次空闲打开执行前先经 Session Move 同步 cwd；只读订阅不移动，活跃 Run 不中断。配置、目录与信任变化在后续空闲执行边界重新加载，见 [ADR-0043](../../docs/adr/0043-session-project-binding.md)。

`session.move { sessionId, projectId }` 的 `projectId` 为 `string | null`：字符串移到另一个已登记 Project 的当前主目录；`null` 将项目 Session 移出到新建的空 `workspace/<id>/` 并删除 Project 绑定，已在“对话”时拒绝重复移出（`invalid_command`）。移动失败清理刚创建的空目录；移出后删除 Session 会按对话目录合同清理新目录，项目文件保留。调用方先对未信任目标完成信任确认。已绑定目标 Project 时返回 `invalid_command`；执行中、有挂起 Interaction、正在打开或被其他进程占用时返回 `session_busy`。已打开且空闲的 Session 先关闭再移动，未打开的 Session 仅取得存储租约修改 cwd 和 Transcript，不恢复任务、创建 Run、解析模型或解密凭据。成功返回 `{}`，保留 id、标题、置顶与归档状态，通过 `sessions_changed` 发布新 cwd；不复制或删除目录文件。下一次 Run 的移动 reminder、环境快照与跨移动回退由 [Agent Core](../agent/README.md) 拥有，见 [ADR-0040](../../docs/adr/0040-session-move-transcript-boundary.md)。

`session.rename { sessionId, title }` 将 Session Title 固定为 user 来源，成功后返回 `{}` 并发送 `sessions_changed`。已在服务中打开的 Session 使用其 `rename`，订阅者还会收到 `session_title_changed`；未打开的 Session 只取得存储写入租约并提交标题，不打开 Session、恢复任务、解析模型或解密凭据。标题按 Core 的用户标题规则规范化；规范化后为空返回 `invalid_command`，不存在返回 `session_not_found`，其他宿主持有租约时返回 `session_busy` 且不写入。

历史订阅通过 Agent Core 的只读快照显示已提交 Transcript，包括跨进程持有 lease 的 Session。展示快照后，通过独立 host mutex 的立即事务探测当前占用，随即回滚并关闭，不写数据或取得 Session 执行权；忙时仍返回 `session_busy`，客户端保留只读与 busy 提示。探测仅反映当时状态，明确执行命令仍重新取得执行 lease。只读访问不恢复任务、调用 Hooks 或解密 MCP 配置，不提供实时事件或别的进程的权限回复。快照保留消息、原生工具状态、排队输入、Run Summaries 与 Todo/Plan/Goal/子代理目录；不重建别的进程的 Background Job 或子代理活动。

无订阅且没有 Run、挂起权限请求、Queued Input、运行中 Background Job 或子代理的 Session，在持续空闲 10 分钟后关闭并释放 lease。归档或删除的准入保护结束后，无论成功或失败，仍由服务持有的空闲 Session 重新开始计时；已删除的 Session 不重新打开。进程收到 SIGTERM/SIGINT，先等待全部 Session abort，再释放 Effect runtime 和 Session、Job 进程组；调用方应等待 close 完成。SIGKILL 无法执行这些清理，孤儿 Job 不回收。

应用库位于 `dataRoot/app.sqlite`，新对话各自独占同级 `workspace/<id>/`；打开失败清理新建空目录。Core 删除 Session 成功后，server 仅删除 cwd 为 `workspace/` 直接子目录且不含符号链接的目录；Project 目录与旧 `workspace/` 根保留，目录清理失败只报告 warning。应用写入使用事务及 WAL/FULL；失败不报告保存成功。Session 索引从数据根内各 Session 库的已提交元数据核对，不依赖项目注册表，发现不取得执行 lease、不恢复任务。损坏元数据记录 warning，不读取旧目录。

[AppDatabase](src/storage/app-database.ts) 提供配置和凭证的原子替换、删除，以及应用索引与能力缓存操作。敏感 MCP 配置（包括 headers、client_secret）及完整 OAuth state（包括 codeVerifier）通过[加密配置 adapter](src/storage/configuration.ts) 整体加密；终端文件来源保持原行为。模型服务写入通过独立鉴权的 `/private/model-services` 接口，仅供 main 调用；会话 WS 不接受凭证写入，也不返回密文或明文。私有通道能力从进程环境捕获后删除，不向工具子进程传递。

`session.archive { sessionId }` 只修改应用 registry：从 `pinned` 移除并加入 `archived`，Session 摘要、Transcript 与 Session Store 保留；未打开的 Session 不启动 Session Resume。已接收而仍在准备模型或认证的 Session 命令、执行中的 Run、Queued Input、Background Job、子代理或挂起 Interaction 返回 `session_busy`；非本服务持有的 Core 写者租约也返回 busy 且保留组织信息。归档与永久删除在首个异步步骤前独占该 Session 的命令准入，直至提交与广播完成；期间其他 Session 命令返回 `session_busy`。空闲 Session 的只读或实时订阅不阻止归档。成功的 `sessions_changed` 携带 `closedSessionId`，客户端只对当前选择的该 Session 返回新聊天；此字段也用于空闲关闭后的视图失效，不表示归档释放执行租约。`session.pin` 对 Archived Session 返回 `session_archived`；不存在的 id 返回 `session_not_found`。本次没有取消归档命令。

`session.delete { sessionId }` 拒绝执行中、Queued Input、Background Job、子代理和挂起 Interaction 的 Session，也拒绝已获命令或打开准入的 Session。空闲已打开 Session 先关闭、释放租约并撤销订阅，再调用 Core 的永久删除；整个命令持有准入保护，期间的 prompt、订阅和其他 Session 命令返回 `session_busy`。成功后清理 `pinned` 与 `archived`，广播带 `closedSessionId` 的 `sessions_changed`，不存在返回 `session_not_found`。另一个宿主赢得写入租约时删除返回 `session_busy` 并保留组织信息，客户端可重试。Core 的存储及文件边界见 [Session Store](../agent/README.md#session-store)。

## 实现导航

[server.ts](src/server.ts) 持有 Hono 接入、单个 ManagedRuntime、Layer 与输入回执 FiberMap；[command.ts](src/command.ts) 在进入业务处理前校验不可信输入。依赖和架构约束见 [tech-stack](../../docs/tech-stack.md) 与 [ADR-0030](../../docs/adr/0030-desktop-server-hono-and-effect.md)。

模型美元价格查询通过同一私有管理入口，只接收 Base URL 和精确模型 ID，不读取凭证。固定读取 [llmprice.cn](https://llmprice.cn/) 首页采用的 [LiteLLM Cost Map](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) 原始 JSON（raw.githubusercontent.com），不回退到 CDN，8 秒超时、8 MiB 上限并拒绝重定向。当前只认 HTTPS 官方主机 api.openai.com、api.anthropic.com、api.deepseek.com、api.mistral.ai、api.groq.com、api.x.ai、openrouter.ai 和 generativelanguage.googleapis.com；自定义代理地址返回歧义，不推测其账单。仅接受 provider 相符的精确 ID 或 provider/ID 键；同 provider 同价格别名可合并，冲突或上下文分层返回歧义。普通每 Token 美元价换算为百万 Token；缺少、无效或零值不视为已知价格，缓存价格缺失保持空白。网络、大小或解析失败返回不可用，不写配置、不提供任意 URL 抓取。

### 浏览器模型服务通道

`system-keychain` 和 `memory` 后端通过鉴权会话 WS 提供 `modelServices.list / save / delete / test / revealKey / prices`，复用 Electron 私有模型服务处理器。`delete`、`test` 与 `revealKey` 用 `providerId` 指定供应商；`save` 接收共享 schema 的供应商与 `keep`、`delete` 或 `replace` 明文凭证，立即按 `provider:<id>` 加密后由数据库同事务提交供应商与密文。加密失败不写供应商。Base URL 按字符串保存，包括空字符串与无法解析的内容；compat 和默认推理档位仍按协议合同校验。模型目录跳过整体停用或 Base URL 无法解析的服务，保留各模型的启用配置，并从服务携带展示图标键。`electron` 后端返回 `model_services_unavailable`，继续走 main 的私有通道。

显式 `revealKey` 只返回指定供应商的 `{value: string | null}`；明文、显示结果和底层凭证错误不进入广播、snapshot、日志或模型上下文。WS 命令保留相同 Origin、token、字段校验和关闭时等待命令完成的规则；模型测试仅发送短连接探测，失败返回安全协议错误。凭证通道边界见 [ADR-0037](../../docs/adr/0037-browser-host-sidecar-capabilities.md)。

## Git Project 独立工作树

`project.git { projectId }` 返回 `{ repository, branch, head, branches }`；`branches` 是主目录可切换的本地分支，按名称排序，排除已被其他工作树检出的分支。主目录不是 Git 仓库顶层、没有提交或 Git 不可用时返回 `{ repository: false, branch: null, head: "", branches: [] }`。detached HEAD 返回 `branch: null` 与当前提交。`project.checkout { projectId, branch }` 切换到列表中的分支，`project.createBranch { projectId, branch }` 校验名称后新建并检出，两者都返回新的 `project.git` 结果并发布 `sessions_changed`。分支名非法、已存在或不在列表中返回 `branch_invalid { branch }`；Git 拒绝（如未提交改动冲突）返回 `git_failed { message }`，不 stash、不强制；绑定该 Project 的非工作树 Session 执行中、等待 Interaction 或被占用时返回 `session_busy`。两者经 Project 变更队列串行，不 fetch。`session.create` 可传 `worktree: true`，只接受已登记 Project。server 创建 `dataRoot/worktrees/<短id>/<仓库目录名>` 和独立生成 id 的 `rukie/worktree-<短id>` 分支，已有分支重试，不 fetch、不带入主目录未提交改动。Git 创建失败返回带输出摘要的 `worktree_failed`，不创建 Session；后续打开失败回滚新工作树及记录并返回打开错误。

本机应用数据库保存工作树记录，Session 绑定保存 `worktreeId`；摘要必填 `worktree: { id, branch } | null`。工作树 Session 从所属 Project 派生信任，附加目录排除主目录，重启和后续执行保留工作树 cwd、跳过主目录懒同步；`session.move` 返回 `worktree_session`。删除 Session 或移除 Project 仅清除 Session 与绑定，保留工作树、记录及分支。`host.revealPath` 与 `host.openInTerminal` 允许已记录的工作树目录及真实子路径，仍拒绝符号链接逃逸；应用数据根的工作树不能登记为 Project。完整决定见 [ADR-0045](../../docs/adr/0045-git-worktree-sessions.md)。

`worktrees.list` 列出已记录且目录仍存在的工作树。`worktree.delete { worktreeId }` 在绑定 Session 的命令、执行、排队、后台工作、Interaction 或外部写入 lease 活跃时返回 `session_busy`；server 准入锁与 Agent Core 实际写者租约一直覆盖 Git 删除、Session Move 和绑定发布。成功执行 `git worktree remove --force`（丢弃未提交改动、保留分支），清除记录与 `worktreeId` 并把绑定 Session 移到 Project 当前主目录。已删除 Session / Project 的工作树仍可单独删除。Git 删除失败返回带摘要的 `worktree_failed`，记录与绑定保留，可恢复源仓库后重试；若 Git 已删除目录但后续 Session Move 或绑定存储失败，记录仍保留；下一次打开（包括重启后）检测目录缺失，先取得写者租约、同步主目录并清除 `worktreeId`，再执行 Resume，无需手动刷新。

`worktrees.refresh` 删除目录已不存在的记录，清除受影响 Session 的 `worktreeId`；下一次打开才同步主目录。刷新对存在的源仓库执行 `git worktree prune`，源仓库缺失时跳过 Git 操作。刷新同样保护受影响 Session 的准入，并返回现存工作树列表；它不会删除仍存在的工作树或派生分支。

MCP 状态查询和订阅独立于 Session 执行权。`mcp.status` 不启动连接；`mcp.subscribe` 可只观察或取得活动项目视图，按 socket 和 viewId 持有，在取消、替换和连接关闭时释放。新会话页无需供应商凭证即可查看状态，Hooks 仍延迟解密。完整参数、状态和租约合同见 [MCP Frontend 接口](../../docs/mcp.md#无-session-的状态视图)。
