# @rukie/ui

浏览器兼容的 React DOM Frontend，负责主窗口、侧栏、输入框与 wire 状态。组件来源和视觉规则见 [DESIGN.md](../../DESIGN.md)，运行边界见 [ADR-0029](../../docs/adr/0029-desktop-package-structure.md)。

## 使用

`App` 接收 `host` 与 `locale`（`zh` / `en`）。Electron preload 注入 `window.rukieHost` 的 `getConnection`、`pickProjectFolder` 和模型服务能力；浏览器开发入口从 URL fragment 读取 `port` 与 `token`，立即从 history 清除 fragment，通过 `getConnection` 连接 sidecar，`pickProjectFolder(multiple?)` 经 `host.pickFolder { multiple? }` wire 命令选择目录，默认支持多选，`false` 限定单个目录，返回 `string[] | null`，取消返回 `null`。握手信息保存在当前标签页的 sessionStorage 中，完整刷新或 Vite 整页重载后复用；新的握手 fragment 会替换旧值，无效 fragment 清除缓存。关闭标签页后，或 sidecar 重启后，需要重新打开启动命令打印的完整地址。存储不可用时当前页面仍可连接，但刷新需重新附加握手 fragment。macOS 浏览器使用系统选择文件夹对话框；取消时保留创建表单；平台返回 `unsupported` 时显示本地化提示并保留可重试的文件夹入口，不提供手动路径输入。Electron 保留窗口内的文件夹对话框。两种入口的 Finder 与终端操作均通过 app 的 wire client 调用 sidecar，受已登记项目根、workspace 与已记录工作树的路径范围限制。浏览器 host 的 `bindClient` 由 app 在执行宿主操作前绑定唯一连接，host 不另开或关闭连接，避免抢占 app 的订阅。

从仓库根运行 `bun run dev:desktop:web`，启动当前源码 sidecar 与固定在 `http://localhost:5173/` 的 Vite dev server，并打印带握手 fragment 的完整地址；`--open` 用默认浏览器打开。UI 源码修改由 HMR 更新，sidecar 源码修改需重启命令。端口占用、握手超时或任一服务退出时命令失败并停止另一个服务；Ctrl+C 或 SIGTERM 等待 Vite、sidecar 顺序退出后释放锁。端口和 token 来自 sidecar stdout 握手，不放进 query、文件或设置。入口跟随系统主题并按浏览器语言选择 zh/en。数据与配置隔离、`--reset` 及锁说明见 [desktop README](../desktop/README.md#浏览器开发)。

代理手工浏览器验收使用 `bun run dev:desktop:web --isolated`，打开输出的带 fragment 地址。入口为本次运行分配临时配置与数据，使用 memory 加密与 loopback fake 供应商；模型服务和 Session 经真实 sidecar，固定回复为 `packaged protocol reply`。关闭浏览器后停止启动器，它等待服务退出并删除临时目录；自动 React DOM 测试仍使用模拟 DesktopHost。原生验收边界见 [testing.md](../../docs/testing.md#原生验收授权边界)。

`App` 的可选 `Conversation` 组件接收持续归约的 TranscriptState、snapshot 元数据、pending Interaction、连接事实与请求接口，以及受控 draft / images。窗口层拥有标题栏、侧栏、项目选择与输入框；Conversation 层接收摘要开关并拥有对话与停靠内容。`SessionViewState` 归约 Run 开始与结束，保留每个 Session 的最新 snapshot；snapshot 替换全量消息，message_end 仅按 entryId 更新或追加该提交条目的投影，流式 partial 独立保存；Interaction 以 epoch 归约，按 request.kind 保存权限、问题与计划评审的联合类型。组件只读 props，app 接线 client、store 和 host。侧栏状态只读 sessions_changed 的 running 和 waitingInteraction 汇总，等待确认优先于运行标记，未订阅会话同样更新；不从可能停更的历史视图猜测后台状态。

## 连接与交互

wire client 用每条命令的 `id` 关联 response。每次重连重新调用 `host.getConnection`，重新订阅已打开的 Session；一次网络断开触发重连，失败或 `superseded` 接管后保持断开，等待用户「重试」。Electron 的 `rukie:connection-change` 事件可暂停连接、显示重连或连接重启后的 sidecar。wire 错误与断连失败通过 zh/en 的安全文案展示，未知错误不暴露协议码或原始异常；断连立即拒绝未完成命令并禁用发送；未确认 Interaction 在重新订阅时由 server 补发。回复用 `interaction.reply` 的 `kind` 匹配请求类型，权限回复沿用允许/拒绝值，问题回复为 answers 或 declined，计划评审回复为 approve/revise/takeover 对象；具体 schema 见 [shared wire](../shared/src/wire.ts)。snapshot 的 `planMode` 与 plan Tool State 更新投影到 SessionViewState.planMode，客户端通过 `session.create.planMode` 预选或 `session.set_plan_mode` 切换。关闭 App 释放 socket 与监听，不停止 sidecar 的 Run。

首次发送才调用 `session.create`，带目标项目、图片、模型选择与 Permission Mode，不先创建空 Session。已有 Session 的输入走 `prompt`，Run 中交给 server 排队；停止返回的 Queued Input 按顺序放在当前 draft 前，保留图片。草稿与附件按 Session 保存并分别记录编辑修订号；成功响应只清理未编辑的已提交版本，新会话创建期间的编辑交接给创建出的 Session，期间切换会话不抢回选择；abort 或撤回响应回填发起请求的 Session，并合并响应时的现有草稿。Session busy 时保留只读 snapshot 并以重试提示替换输入框。权限、推理档次和上下文面板使用 server 的 `session_state`，模型档次来自目录中的原生能力子集。

⌘N 新建对话，⌘K / Ctrl+K 打开搜索，⌃1–⌃9 按当前未归档 Session 的排序选择 Session，⌥⌘P 置顶或取消置顶。分组折叠、显示与排序通过 `preferences.set` 保存。输入框 Enter 发送、Shift+Enter 换行；输入法组合中的 Enter 不发送。纯图标控件带 tooltip 和可访问名称。

Project 按 server 提供的 Session 摘要 `projectId` 分组；该值来自应用库的持久绑定，不按 cwd 推测。新 Session 使用主目录，切换主目录后已有普通 Project Session 在下次空闲打开执行前同步；只读订阅历史不移动，工作树 Session 保留工作树 cwd。添加项目与搜索的“打开文件夹”共用多目录选择、主目录设置和信任确认；取消创建确认不发送命令，确认后发送带必填名称的 `project.create { name, directories, trusted: true }`。所选主目录已登记时直接在原 Project 中新建草稿；未信任 Project 在新建或打开 Session 前补确认，拒绝仍可使用 Session，但不加载项目级配置。目录所有权、真实路径与信任边界见 [server README](../server/README.md#行为与限制)。

欢迎页 Project 下拉的“编辑项目”预填名称、有序目录和主目录；改名、增删目录与主目录切换都在草稿中完成，保存时统一发送 `project.update { projectId, name, directories, primary, trusted? }`。无修改或空名称不能保存；移除主目录由下一个目录接任，最后一个目录不能移除。已信任 Project 新增目录先确认所有目录，并标记新增项，确认后带 `trusted: true` 保存；未信任 Project 直接保存且保持未信任。取消、关闭和 Esc 放弃编辑；取消信任确认回到原草稿。错误留在编辑表单并显示本地化 alert。

“移除本地项目”经确认后发送 `project.remove { projectId }`，删除全部绑定 Session（含置顶和归档）、Transcript 及相应组织记录，再移除 Project 登记；项目目录文件与独立工作树保留。取消确认回到草稿。项目下有执行中、等待 Interaction 或被其他执行 owner 占用的 Session 时禁用移除，服务端 `session_busy` 拒绝也在确认框显示原因。成功删除当前 Session 后取消订阅并返回首页；中途失败保留 Project 登记供重试，已删除 Session 不恢复。编辑或删减 Project 目录保持 Session 绑定。提交期间禁止重复操作和关闭。弹窗使用 [DESIGN.md](../../DESIGN.md#project-directories-and-trust) 的局部尺寸与颜色，长名称保留完整可访问标题，窄屏仍显示关闭与底栏。

会话行右键、行内更多与标题栏菜单共用“移动到项目”，依次列出其他 Project、项目会话专有的“移出项目”、分隔线和“选择文件夹…”，执行中、等待确认或绑定工作树时禁用。移出发送 `session.move { projectId: null }`，会话获得新的空对话目录。选择文件夹调用单目录 host 选择，经信任确认后执行 `project.create`，主目录相同时复用返回的 Project，再发送 `session.move`；目录冲突显示本地化错误，取消选择或信任不创建不移动，移动失败保留已经创建的 Project。未信任目标先确认并完成 `project.trust`，再发送 `session.move`；取消不移动。成功后按新的 `projectId` 分组，当前 Session 重新订阅，失败显示本地化错误并保留当前对话。Session Move 的持久化和执行边界见 [server README](../server/README.md#行为与限制)。

搜索聊天浮层沿用 CommandPalette，聊天结果列出全部未归档 Session，独立按更新时间降序排列，匹配 Session Title 和 Project 名称；右侧仅显示所属 Project，执行中的 Session 显示 Running 图标。结果在 A13 ScrollArea 内滚动，快捷操作固定在其下方，提供新聊天与打开文件夹。方向键跨两个分组移动，Enter 执行，Esc 或点击背景关闭并恢复搜索入口焦点；打开文件夹沿用添加项目流程，并在搜索释放焦点后交给文件夹选择器或项目创建表单。浮层几何与直接切换的减少动态效果规则见 [DESIGN.md](../../DESIGN.md#search-overlay)。

store 严格校验 `sessions_changed.archived` 的 Session id 列表，并保留完整 Session 摘要；侧栏、搜索与数字导航排除 Archived Session。会话行右键、行内更多和标题栏菜单共用归档操作，执行中或等待确认时禁用。归档当前选择的 Session 后 App 取消订阅并返回首页新聊天，其他 Session 的归档不切换当前对话；`closedSessionId` 使对应缓存视图失效。归档不删除 Transcript 或 Session Store，也没有取消归档入口。

三个 Session 菜单共用“永久删除”危险操作，执行中或等待确认时禁用。确认弹窗先聚焦取消，明确说明不可撤销及 Session、子代理、附件和文件历史的移除；无 Project 绑定时另说明对话工作目录也会删除，项目会话不删除项目文件；取消、Esc 与关闭不发命令，确认期间禁用重复提交，失败保留弹窗与错误。成功删除当前 Session 后 App 取消订阅并返回首页新聊天；删除其他 Session 保持当前选择，失效缓存由 `closedSessionId` 清理。

## 模型服务

会话输入框的模型入口按 Pencil C06/C07 展示已认证的模型目录、供应商品牌图标、名称和当前选择。打开时预览当前模型或首个可用模型；悬停和方向键聚焦仅更新输入能力、上下文容量与支持的推理档位。Right Arrow 进入推理按钮，Left Arrow 返回模型行；点击模型采用配置默认推理，点击档位显式选择模型与该档位，Escape 关闭并保留原选择。打开时只显示模型列表，hover 或键盘聚焦模型后展示对应详情，重新打开清除预览。详情出现时列表位置保持稳定；宽屏并排、窄屏上下排列，长列表使用已有 ScrollArea；尺寸、主题和字体由 [DESIGN.md](../../DESIGN.md#conversation-model-controls) 约束。未知自定义供应商使用通用图标。上下文面板只显示现有 ContextReport 事实，不展示尚未提供的五类消息统计或压缩阈值。

Electron 与浏览器宿主都提供完整 `modelServices`，左侧导航开放模型服务设置；设置导航从搜索框开始，使用标题栏后退返回原聊天布局与草稿。设置复用 beUI 字段、选择器、按钮、复选框和模态框，以及 shadcn 菜单，组合供应商总览、自定义供应商创建、详情、模型编辑与删除确认；添加入口先提供自定义供应商，再提供手工维护的供应商预设；点击后立即保存并选中。模型 ID 与基础参数由用户填写；高级设置按当前 C16 展示自动压缩、运行参数与价格卡片，可选字段可填写或清空。来源预设保留期间，API Key 标签旁提供获取链接；浏览器打开外部标签，Electron 仅通过 main 的固定地址许可交给系统浏览器，拒绝应用内弹窗。刚从预设创建的当前服务切换协议时替换为对应变体的地址和模型；切换服务或卸载后清除来源，之后协议更改保留模型参数。

供应商名称、Base URL、API 格式和模型配置通过宿主保存。创建和重命名允许空 Base URL，输入通过宿主配置通道保存，执行目录跳过无效地址；协议兼容结构由宿主 schema 校验。已有密钥默认显示紧凑遮罩；主动点击显示时，宿主按指定供应商返回 API Key 到当前详情的临时内存。隐藏、切换供应商、保存和退出清除展示，过期请求不更新页面；展示本身不改变保存语义，留空保留，替换与删除明确提交。Electron main 负责受信任 IPC 与系统加密，renderer 不取得任意解密能力。保存失败保留输入；取消不提交。供应商删除确认同时移除配置与密文，历史 Transcript 保留，引用不可用模型的 Session 必须重新选择。保存后刷新聊天模型目录，启用且可认证的模型可以选择；连接验证显式发送一个短请求，失败展示安全文案，不暴露凭证或底层响应。

当前适配器支持文本、图片、对话中系统消息兼容标志，以及从低到高的 Thinking Level 和原生参数映射；映射中的 `null` 表示该档位不支持；基础档位省略映射时仍可用，`xhigh`/`max` 需要显式映射。模型级默认推理等级通过 beUI Select 选择并保存在桌面供应商配置中；选择“自动”不保存默认值。新建 Session 和采用模型时使用模型默认值，显式会话等级优先；恢复已有 Session 保留已保存选择。取消支持当前默认档位时清除该默认值，编辑保留其余原生映射。视频输入控件禁用并说明限制；模型弹窗不显示协议兼容字段或原生参数映射编辑器，修改可见字段时保留模型已有兼容字段和映射。浏览器宿主通过 app 绑定的唯一 wire client 调用 `modelServices.*`，不另开连接、不缓存命令输入或显示密钥结果；服务列表响应经 schema 校验。浏览器新密钥经 loopback WS 传给 sidecar 立即加密，明文只存在于当前输入或显式显示状态；Electron 保留 main IPC 加密通道。浏览器自动测试使用脚本化 wire server 与非生产凭证，不能代替真实系统加密验收。

模型 ID 失焦或打开缺少价格的已有模型时，宿主从用户指定的 [LiteLLM Cost Map](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) 原始美元数据补齐未填写的价格及来源，单位为 USD/百万 Token。手动设置的值（包括零）和请求期间修改或清空的字段保持不变；改变 ID 清除本次尚未保存的自动结果，保存后的价格属于用户配置，改 ID 时保留，须自行检查来源。关闭、切换模型或过期请求不更新表单；失败可再次使 ID 失焦重试。取价期间保存按钮禁用，结束或失败后恢复；状态显示在已有价格卡片标题行，完整文字可通过悬停标题查看。

## 验证

按 [测试策略](../../docs/testing.md#桌面测试入口) 准备 Chromium 后运行 `bun run test:desktop`。Node client/store 测试和 browser app 测试使用脚本化 wire server，不调用模型，也不接触用户设置或 Session；真实 server 与 Agent Core 行为在 server 包测试。Chromium DOM 验证不能代替本地打包后 Electron 验证。

## 对话呈现

Transcript 呈现按用户输入分组（`PromptGroup`），组内保留多次 Turn，不改变 Agent Core 的 Turn 定义。所有助手正文独立使用 beUI Streaming Response 展示，不带「消息」步骤标题。连续推理与工具调用组成一个 Agent Activity 的 Agent Trace 活动段，每段助手正文切开前后活动段，保持原始先后顺序；推理和工具调用可在同一段内。活动段执行中仅在最外层段标题以单行 beUI Text Shimmer 展示最新条目的命令、路径或推理详情，长内容截断并保留完整可访问名称和悬停标题；段内所有工具结算后，标题才按工具类别汇总读取、执行、搜索等事实，仅推理的已结束段显示分析完成，展开 Run 后各活动段默认收起，标题可单独展开和收起；手动选择在流式更新和结束后保留。段内条目不展示左侧分割线，工具调用与推理的图标、标题左对齐，统一采用次要字号与主题次要文字色，并缩小条目和活动段的纵向间距。Run 进行中标题复用 beUI Agent Loading States 的 Thinking Shimmer 显示「已处理」时长，尊重减少动态效果偏好；结束后显示「已用时」时长；分割线始终紧接标题。展开活动区展示完整内容，不限制高度，也不使用内部滚动或滑动视窗。组内标题与箭头直接控制活动区展开和收起，支持鼠标、Enter 与 Space；收起 Run 仅隐藏活动段，所有中间与最终助手正文始终可见，没有独立的步骤按钮。推理默认收起，收起后不在条目旁展示内容预览或徽章，点击推理标题或使用 Enter／Space 展开；工具调用仅由工具卡展示一个类型图标。正在执行的组默认展开，允许手动收起；完成后默认收起，中止与失败默认展开并保留状态，原生 provider 错误作为回复组的警告展示。TanStack 按组测量虚拟行，容器为 `role="feed"`；在底部时跟随追加和行高增长，上翻停止跟随，Preview Rail 位于会话详情区域左侧 20px，按包含输入或审批停靠区的完整面板高度垂直居中，刻度跳转并预览问题与回复；窄窗口仍可操作，消息区保留左侧空间避免刻度遮挡正文。右侧滚动条覆盖聊天面板全高度（含输入或审批停靠区），按 Transcript 的实际滚动范围映射位置，聊天滚到底时滑块贴合轨道底部；支持拖动、点击轨道、方向键、PageUp／PageDown、Home／End，并随内容高度和窗口尺寸更新。原生滚动条隐藏，避免重复。刻度默认均为 6px 短线，hover、键盘聚焦或触摸预览时才展示靠近预览项的长度梯度，最大长度 24px，行间距 8px；静止时当前回答组（运行中的组，否则最后一组）使用高对比主题文字色，预览时只有指向或聚焦的组使用高对比色，其余刻度使用浅色层级；预览复用 Tooltip portal，hover 或键盘聚焦可读，Esc 关闭，并在 viewport 内定位，不受轨道滚动裁切。屏幕外的组不在 DOM 中，读屏与页内查找只覆盖已渲染部分。

工具以提交的 assistant entry ID 与 call ID 组合归约，实时事件通过当前调用索引关联，复用 provider ID 不覆盖历史；默认折叠，失败展开。ANSI 输出通过 anser 解析标准、256 色与 RGB SGR 并剔除 OSC/光标控制；diff 按 unified hunk 分行，旧文与新文分别高亮，流式工具/diff 输出不使用 aria-live。Markdown 解析成 React 文本节点，不执行 HTML 或链接导航。所有代码块按需加载并共用 GitHub Light/Dark Shiki 高亮器；完整块缓存最多 64 条，超过 12,000 个字符或 200 行显示纯文本。未闭合代码块使用 ShikiStreamTokenizer，仅重算不稳定尾部。

待审批请求在底部输入框原位置以 beUI Tool Approval 默认样式逐张展示，参数详情默认收起，同时到达的请求按 Interaction epoch 排队；处理当前请求后显示下一张，队列清空后恢复草稿、附件与输入焦点。权限停靠卡以 epoch 关联回复；Esc 拒绝、A 在 Session 内允许、Enter 允许，编辑文本、组合输入与菜单/模态框不触发这些快捷键。断连禁用回复；settled 与 stale 删除对应 epoch，重新订阅时使用 server 补发的新请求。同意与 Session 内允许不会在 Trace 中添加批准卡；拒绝决定使用 Tool Approval 的 denied 样式保留在当前窗口活动区，参数详情默认收起；重启窗口后以已提交工具结果事实为准。摘要显示当前 Todo 与子代理状态。

权限请求到达时按 Interaction epoch 保存当前 PromptGroup 与活动位置；拒绝后，Tool Approval 结果卡位于对应工具执行卡之前，子代理请求保留其父活动位置，不会随后续活动或复用的 provider call ID 移到 Run 末尾。长命令在参数详情中换行，窄窗口将参数标签与内容纵向排列。断连期间保留停靠卡并禁用按钮，恢复连接时清除旧 epoch，重新订阅后接受补发；待审批及提交应答期间保留草稿和附件并隐藏输入框，审批按钮在命令应答前禁用；断线说明和重试入口保持可见。

The conversation Plus opens the Pencil C09 attachment menu and keeps image picking, paste and drop on their existing path. Context details use the Pencil C08 usage/legend layout with the current System, Messages and Tools report estimates; displayed percentages divide by used tokens, while the capacity bar divides by the model window. Opening context and compaction count remain separate facts. Unsupported plugin actions and finer message category totals are not fabricated.

供应商表单自动保存：Base URL 和 API Key 停止输入 500ms 后提交，切换服务、离开设置或卸载立即提交待保存输入；服务开关、协议和模型操作立即提交。请求串行执行，保存结果不覆盖后续编辑，失败保留输入并显示安全错误提示。表单没有保存与取消按钮；重命名和模型编辑在确认后提交，取消或关闭不提交。服务开关独立控制 `enabled`，不改变模型自身开关。

侧栏 Project 行以 server 投影的当前 Session `projectId` 显示选中背景；会话数排除归档并包含置顶。悬停 300ms 或键盘聚焦打开受控 beUI 详情卡，卡片以行背景矩形右侧 4px、顶边对齐锚定，按视口夹取且逃逸滚动裁切；指针通道保留该间隙，离开行与卡片 150ms 后关闭。ArrowRight 从项目行进入卡片操作；图钉临时固定详情，其他项目的悬停或聚焦不替换它，再次切换图钉、Escape 或外部点击关闭。编辑入口复用 C29；新聊天、设置及其他弹窗暂停详情卡。App 拥有打开与固定状态，可由后续菜单互斥控制。完整目录路径只按已校验的 `sessions_changed.homeDir` 家目录身份及分隔符边界缩写为 `~`；未收到元数据或不属于家目录时保持完整路径。

新聊天在主输入框上方显示 rukie.pen M03-A 的选择条，Session 创建后隐藏。项目菜单可搜索、勾选当前项目、添加新项目或不使用项目；项目态的 x 只取消本次选择。Git Project 显示分支菜单：`project.git` 的全部可切换本地分支、搜索、`project.checkout` 切换、以搜索内容 `project.createBranch` 新建并检出，以及独立工作树选项。切换失败或 Session 忙碌时错误显示在仍打开的菜单内。几何与交互规则见 [DESIGN.md](../../DESIGN.md#new-chat-worktree-selection)。

设置 → 环境 → 工作树通过 `worktrees.list` 显示独立工作树的分支、仓库目录名与路径；“刷新”调用 `worktrees.refresh` 清理失效记录。删除确认写明完整路径、未提交改动丢弃与分支保留，成功调用 `worktree.delete` 后更新列表，绑定 Session 回到主项目目录。忙碌错误留在弹窗内，取消接收初始焦点，提交期间阻止重复提交和关闭。空列表显示“暂无独立工作树”。界面复用已安装的 beUI Button / MorphingModal 和设置 ScrollArea，颜色、尺寸与窄宽度行为由 [DESIGN.md](../../DESIGN.md#worktree-settings) 定义。
