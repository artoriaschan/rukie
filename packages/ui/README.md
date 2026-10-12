# @rukie/ui

浏览器兼容的 React DOM Frontend，负责主窗口、侧栏、输入框与 wire 状态。组件来源和视觉规则见 [DESIGN.md](../../DESIGN.md)，运行边界见 [ADR-0029](../../docs/adr/0029-desktop-package-structure.md)。

## 使用

`App` 接收 `host` 与 `locale`（`zh` / `en`）。Electron preload 注入 `window.rukieHost` 的 `getConnection`、`pickProjectFolder` 和模型服务能力；浏览器开发入口从 URL fragment 读取 `port` 与 `token`，立即从 history 清除 fragment，通过 `getConnection` 连接 sidecar，`pickProjectFolder` 经 `host.pickFolder` wire 命令选择项目。完整刷新后需重新附加握手 fragment；当前页面中的 Retry 重用内存中的凭据。macOS 浏览器使用系统选择文件夹对话框；取消或平台返回 `unsupported` 时退回手动填写绝对路径。Electron 保留窗口内的文件夹对话框。两种入口的 Finder 与终端操作均通过 app 的 wire client 调用 sidecar，受已登记项目根与 workspace 的路径范围限制。浏览器 host 的 `bindClient` 由 app 在执行宿主操作前绑定唯一连接，host 不另开或关闭连接，避免抢占 app 的订阅。

从仓库根运行 `bunx --no vite --config packages/ui/vite.config.ts packages/ui`，Vite 固定使用 `http://localhost:5173/`，占用端口时退出；打开此地址并附加 `#port=<sidecar-port>&token=<sidecar-token>`。sidecar 必须以开发模式运行，见 [server README](../server/README.md)。端口和 token 来自当前 sidecar 的 stdout 握手，不放进 query、文件或设置。入口跟随系统主题并按浏览器语言选择 zh/en。

`App` 的可选 `Conversation` 组件接收持续归约的 TranscriptState、snapshot 元数据、pending Interaction、连接事实与请求接口，以及受控 draft / images。窗口层拥有标题栏、侧栏、项目选择与输入框；Conversation 层接收摘要开关并拥有对话与停靠内容。`SessionViewState` 归约 Run 开始与结束，保留每个 Session 的最新 snapshot；snapshot 替换全量消息，message_end 仅按 entryId 更新或追加该提交条目的投影，流式 partial 独立保存；Interaction 以 epoch 归约。组件只读 props，app 接线 client、store 和 host。侧栏状态只读 sessions_changed 的运行和权限汇总，等待确认优先于运行标记，未订阅会话同样更新；不从可能停更的历史视图猜测后台状态。

## 连接与交互

wire client 用每条命令的 `id` 关联 response。每次重连重新调用 `host.getConnection`，重新订阅已打开的 Session；一次网络断开触发重连，失败或 `superseded` 接管后保持断开，等待用户「重试」。Electron 的 `rukie:connection-change` 事件可暂停连接、显示重连或连接重启后的 sidecar。wire 错误与断连失败通过 zh/en 的安全文案展示，未知错误不暴露协议码或原始异常；断连立即拒绝未完成命令并禁用发送；未确认 Interaction 在重新订阅时由 server 补发。关闭 App 释放 socket 与监听，不停止 sidecar 的 Run。

首次发送才调用 `session.create`，带目标项目、图片、模型选择与 Permission Mode，不先创建空 Session。已有 Session 的输入走 `prompt`，Run 中交给 server 排队；停止返回的 Queued Input 按顺序放在当前 draft 前，保留图片。草稿与附件按 Session 保存并分别记录编辑修订号；成功响应只清理未编辑的已提交版本，新会话创建期间的编辑交接给创建出的 Session，期间切换会话不抢回选择；abort 或撤回响应回填发起请求的 Session，并合并响应时的现有草稿。Session busy 时保留只读 snapshot 并以重试提示替换输入框。权限、推理档次和上下文面板使用 server 的 `session_state`，模型档次来自目录中的原生能力子集。

⌘N 新建对话，⌘K / Ctrl+K 打开搜索，⌃1–⌃9 按当前「最近」排序选择 Session，⌥⌘P 置顶或取消置顶。分组折叠、显示与排序通过 `preferences.set` 保存。输入框 Enter 发送、Shift+Enter 换行；输入法组合中的 Enter 不发送。纯图标控件带 tooltip 和可访问名称。

## 模型服务

会话输入框的模型入口按 Pencil C06/C07 展示已认证的模型目录、供应商品牌图标、名称和当前选择。打开时预览当前模型或首个可用模型；悬停和方向键聚焦仅更新输入能力、上下文容量与支持的推理档位。Right Arrow 进入推理按钮，Left Arrow 返回模型行；点击模型采用配置默认推理，点击档位显式选择模型与该档位，Escape 关闭并保留原选择。打开时只显示模型列表，hover 或键盘聚焦模型后展示对应详情，重新打开清除预览。详情出现时列表位置保持稳定；宽屏并排、窄屏上下排列，长列表使用已有 ScrollArea；尺寸、主题和字体由 [DESIGN.md](../../DESIGN.md#conversation-model-controls) 约束。未知自定义供应商使用通用图标。上下文面板只显示现有 ContextReport 事实，不展示尚未提供的五类消息统计或压缩阈值。

Electron 与浏览器宿主都提供完整 `modelServices`，左侧导航开放模型服务设置；返回应用恢复原聊天布局与草稿。设置复用 beUI 字段、选择器、按钮、复选框和模态框，以及 shadcn 菜单，组合供应商总览、自定义供应商创建、详情、模型编辑与删除确认；添加入口只提供自定义供应商。模型 ID 与基础参数由用户填写；高级设置按当前 C16 展示自动压缩、运行参数与价格卡片，可选字段可填写或清空。协议更改保留全部模型参数，保存前校验目标协议的兼容字段，不匹配时要求编辑或移除相关模型。

供应商名称、Base URL、API 格式和模型配置通过宿主保存；已有密钥默认显示紧凑遮罩；主动点击显示时，宿主按指定供应商返回 API Key 到当前详情的临时内存。隐藏、切换供应商、保存和退出清除展示，过期请求不更新页面；展示本身不改变保存语义，留空保留，替换与删除明确提交。Electron main 负责受信任 IPC 与系统加密，renderer 不取得任意解密能力。保存失败保留输入；取消不提交。供应商删除确认同时移除配置与密文，历史 Transcript 保留，引用不可用模型的 Session 必须重新选择。保存后刷新聊天模型目录，启用且可认证的模型可以选择；连接验证显式发送一个短请求，失败展示安全文案，不暴露凭证或底层响应。

当前适配器支持文本、图片、对话中系统消息兼容标志，以及从低到高的 Thinking Level 和原生参数映射；映射中的 `null` 表示该档位不支持；基础档位省略映射时仍可用，`xhigh`/`max` 需要显式映射。模型级默认推理等级通过 beUI Select 选择并保存在桌面供应商配置中；选择“自动”不保存默认值。新建 Session 和采用模型时使用模型默认值，显式会话等级优先；恢复已有 Session 保留已保存选择。取消支持当前默认档位时清除该默认值，编辑保留其余原生映射。视频输入控件禁用并说明限制；模型弹窗不显示协议兼容字段或原生参数映射编辑器，修改可见字段时保留模型已有兼容字段和映射。浏览器宿主通过 app 绑定的唯一 wire client 调用 `modelServices.*`，不另开连接、不缓存命令输入或显示密钥结果；服务列表与模板响应经 schema 校验。浏览器新密钥经 loopback WS 传给 sidecar 立即加密，明文只存在于当前输入或显式显示状态；Electron 保留 main IPC 加密通道。浏览器自动测试使用脚本化 wire server 与非生产凭证，不能代替真实系统加密验收。

模型 ID 失焦或打开缺少价格的已有模型时，宿主从用户指定的 [LiteLLM Cost Map](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) 原始美元数据补齐未填写的价格及来源，单位为 USD/百万 Token。手动设置的值（包括零）和请求期间修改或清空的字段保持不变；改变 ID 清除本次尚未保存的自动结果，保存后的价格属于用户配置，改 ID 时保留，须自行检查来源。关闭、切换模型或过期请求不更新表单；失败可再次使 ID 失焦重试。取价期间保存按钮禁用，结束或失败后恢复；状态显示在已有价格卡片标题行，完整文字可通过悬停标题查看。

## 验证

按 [测试策略](../../docs/testing.md#桌面测试入口) 准备 Chromium 后运行 `bun run test:desktop`。Node client/store 测试和 browser app 测试使用脚本化 wire server，不调用模型，也不接触用户设置或 Session；真实 server 与 Agent Core 行为在 server 包测试。Chromium DOM 验证不能代替本地打包后 Electron 验证。

## 对话呈现

Transcript 呈现按用户输入分组（`PromptGroup`），组内保留多次 Turn，不改变 Agent Core 的 Turn 定义。所有助手正文独立使用 beUI Streaming Response 展示，不带「消息」步骤标题。连续推理与工具调用组成一个 Agent Activity 的 Agent Trace 活动段，每段助手正文切开前后活动段，保持原始先后顺序；推理和工具调用可在同一段内。活动段执行中仅在最外层段标题以单行 beUI Text Shimmer 展示最新条目的命令、路径或推理详情，长内容截断并保留完整可访问名称和悬停标题；段内所有工具结算后，标题才按工具类别汇总读取、执行、搜索等事实，仅推理的已结束段显示分析完成，展开 Run 后各活动段默认收起，标题可单独展开和收起；手动选择在流式更新和结束后保留。段内条目不展示左侧分割线，工具调用与推理的图标、标题左对齐，统一采用次要字号与主题次要文字色，并缩小条目和活动段的纵向间距。Run 进行中标题复用 beUI Agent Loading States 的 Thinking Shimmer 显示「已处理」时长，尊重减少动态效果偏好；结束后显示「已用时」时长；分割线始终紧接标题。展开活动区展示完整内容，不限制高度，也不使用内部滚动或滑动视窗。组内标题与箭头直接控制活动区展开和收起，支持鼠标、Enter 与 Space；收起 Run 仅隐藏活动段，所有中间与最终助手正文始终可见，没有独立的步骤按钮。推理默认收起，收起后不在条目旁展示内容预览或徽章，点击推理标题或使用 Enter／Space 展开；工具调用仅由工具卡展示一个类型图标。正在执行的组默认展开，允许手动收起；完成后默认收起，中止与失败默认展开并保留状态，原生 provider 错误作为回复组的警告展示。TanStack 按组测量虚拟行，容器为 `role="feed"`；在底部时跟随追加和行高增长，上翻停止跟随，Preview Rail 位于会话详情区域左侧 20px，按包含输入或审批停靠区的完整面板高度垂直居中，刻度跳转并预览问题与回复；窄窗口仍可操作，消息区保留左侧空间避免刻度遮挡正文。右侧滚动条覆盖聊天面板全高度（含输入或审批停靠区），按 Transcript 的实际滚动范围映射位置，聊天滚到底时滑块贴合轨道底部；支持拖动、点击轨道、方向键、PageUp／PageDown、Home／End，并随内容高度和窗口尺寸更新。原生滚动条隐藏，避免重复。刻度默认均为 6px 短线，hover、键盘聚焦或触摸预览时才展示靠近预览项的长度梯度，最大长度 24px，行间距 8px；静止时当前回答组（运行中的组，否则最后一组）使用高对比主题文字色，预览时只有指向或聚焦的组使用高对比色，其余刻度使用浅色层级；预览复用 Tooltip portal，hover 或键盘聚焦可读，Esc 关闭，并在 viewport 内定位，不受轨道滚动裁切。屏幕外的组不在 DOM 中，读屏与页内查找只覆盖已渲染部分。

工具以提交的 assistant entry ID 与 call ID 组合归约，实时事件通过当前调用索引关联，复用 provider ID 不覆盖历史；默认折叠，失败展开。ANSI 输出通过 anser 解析标准、256 色与 RGB SGR 并剔除 OSC/光标控制；diff 按 unified hunk 分行，旧文与新文分别高亮，流式工具/diff 输出不使用 aria-live。Markdown 解析成 React 文本节点，不执行 HTML 或链接导航。所有代码块按需加载并共用 GitHub Light/Dark Shiki 高亮器；完整块缓存最多 64 条，超过 12,000 个字符或 200 行显示纯文本。未闭合代码块使用 ShikiStreamTokenizer，仅重算不稳定尾部。

待审批请求在底部输入框原位置以 beUI Tool Approval 默认样式逐张展示，参数详情默认收起，同时到达的请求按 Interaction epoch 排队；处理当前请求后显示下一张，队列清空后恢复草稿、附件与输入焦点。权限停靠卡以 epoch 关联回复；Esc 拒绝、A 在 Session 内允许、Enter 允许，编辑文本、组合输入与菜单/模态框不触发这些快捷键。断连禁用回复；settled 与 stale 删除对应 epoch，重新订阅时使用 server 补发的新请求。同意与 Session 内允许不会在 Trace 中添加批准卡；拒绝决定使用 Tool Approval 的 denied 样式保留在当前窗口活动区，参数详情默认收起；重启窗口后以已提交工具结果事实为准。摘要显示当前 Todo 与子代理状态。

权限请求到达时按 Interaction epoch 保存当前 PromptGroup 与活动位置；拒绝后，Tool Approval 结果卡位于对应工具执行卡之前，子代理请求保留其父活动位置，不会随后续活动或复用的 provider call ID 移到 Run 末尾。长命令在参数详情中换行，窄窗口将参数标签与内容纵向排列。断连期间保留停靠卡并禁用按钮，恢复连接时清除旧 epoch，重新订阅后接受补发；待审批及提交应答期间保留草稿和附件并隐藏输入框，审批按钮在命令应答前禁用；断线说明和重试入口保持可见。

The conversation Plus opens the Pencil C09 attachment menu and keeps image picking, paste and drop on their existing path. Context details use the Pencil C08 usage/legend layout with the current System, Messages and Tools report estimates; displayed percentages divide by used tokens, while the capacity bar divides by the model window. Opening context and compaction count remain separate facts. Unsupported plugin actions and finer message category totals are not fabricated.
