# 07：Run/Trace 呈现符合 DESIGN.md 契约

Status: resolved
Blocked by: 01, 02

**What to build:** 让 Transcript 的执行过程呈现符合 DESIGN.md「Run and Trace presentation」一节，重点是读者展开选择的保持和生命周期默认值。实现依据是 [spec](../spec.md) 的「Run/Trace」一节。改动只涉及呈现，不改变 Session、Run、Run Outcome、Interaction 或权限语义。

## 已确认的不符合项（基线 `cc17c80b`）

- `components/transcript.tsx:51-53`：失败、中止或运行状态下用 effect 执行 `setExpanded(true)`，会覆盖读者已经收起的选择。DESIGN.md 第 356 行要求此时不重开。
- `components/transcript.tsx:48` 的 PromptGroup 展开状态、活动段 `AgentActivity` 的内部 `defaultOpen` 状态，以及 `components/tool-row.tsx:93` 的工具详情状态，都是虚拟行内部的组件 state，虚拟行回收后重新挂载就会丢失。DESIGN.md 第 356 行要求在当前 keyed Session 视图中保留这些选择。
- `tool-row.tsx:93` 只在挂载时根据 `tool.status === "error"` 决定初始展开。工具在挂载后才失败时，不会按默认展开。

## 任务

- [x] 先对照 DESIGN.md 的 Required presentation scenarios 表，逐行审计当前实现，把结论写入 Comments。审计范围还包括：
  - 外层摘要的单行 Text Shimmer 和完成后的类别摘要。
  - 「已处理」和「已用时」。
  - 拒绝结果出现在原位置。
  - 并行调用和复用 provider call ID 时身份稳定。
  - 收起时焦点回到披露控件。
  - 已关闭的详情不在可访问树中。
  - 没有嵌套的纵向滚动。
  - 420px 宽度下可用。
- [x] 每个不符合项先写一个失败的公开行为测试，用 App `start` 或 wire 脚本复现。涉及流式更新顺序的场景，要复现相关的更新顺序。然后再修复。
- [x] 在当前 keyed Session 视图中新增展开选择状态，按呈现身份记录读者的显式选择：PromptGroup、活动段和工具调用的投影 id。没有显式选择时，使用生命周期默认值：
  - 进行中：展开。
  - 正常结束：收起。
  - 失败或中止：展开。
  - 历史记录：按已知结局推导。
  - 活动段：收起。
  - 推理：收起。
  - 失败的工具：展开。

  这份状态不持久化，也不进 store 中的 Core 投影。完整重置视图后恢复为默认值。

- [x] 移除强制重开的 effect。错误和结局在收起状态的摘要中保持可见。
- [x] 测试覆盖以下场景：
  - 读者在流式 delta、工具完成、外层结束和虚拟行回收之前做出的展开或收起选择，之后都保持不变。
  - 挂载后才失败的工具按默认展开，除非读者已做选择。
  - 失败、中止、正常结束和未知历史结局的默认值。
  - 选择不会重置焦点或文本选区。
  - 展开时保持阅读锚点，只在读者位于实时边缘时跟随。
  - 减少动态效果。
  - zh 和 en。
- [x] 运行 transcript、tool-output、conversation-dock 等受影响的文件。共享的虚拟化和滚动行为跨模块，需运行一次 `bun run test:desktop`。
- [x] 用 agent-browser 验收：使用 loopback fake provider 跑一次带推理、工具、失败和并行调用的 Run，检查 Light、Dark 和 420px 宽度。
- [x] 同步更新 `packages/ui/README.md` 的「对话呈现」一节。

## Comments

## 实施前审计与授权差异

公开测试 seam 沿用 spec：App/wire 的生命周期、键盘/可访问语义及浏览器几何；ToolRow 的分页公开接口。沿用已安装 beUI AgentActivity/ToolResult，不新增组件来源。

| Required scenario                      | 审计与处理                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| 推理→工具→正文→后续活动                | 现有 chronological sections 与正文持久显示正确，复用现有 App 回归                   |
| 进行/结束/失败/中止/未知历史           | effect 覆盖显式选择；历史缺时间却合成时间；收起摘要缺工具失败/拒绝/取消，补公开回归 |
| delta/settlement/remount               | 选择属于虚拟行，移到 keyed AppConversation，按消息及调用呈现身份独立记录            |
| 并行/逆序/复用 id                      | projection 正确；补显示状态和 partial→commit 身份保持，不改 Core/wire               |
| 长参数/输出/diff/ANSI                  | 已有 typed renderer/分页；缺安全参数区、输出为空提示；ToolResult 220px 内滚动需删除 |
| Permission/deny/disconnect/restore     | 现有 dock/epoch/原位置覆盖保留；补收起摘要的拒绝可见性                              |
| top/middle/live/resize                 | 现有 virtualizer/rail/scrollbar 覆盖保留；扩展虚拟回收和阅读锚点断言                |
| Light/Dark/420/low/enlarged/zh/reduced | 现有 reduced motion/本地化基础保留；补 Trace 几何及真实浏览器验收                   |

| 区域                | 属性                  | 旧值                              | 授权新值                                                      |
| ------------------- | --------------------- | --------------------------------- | ------------------------------------------------------------- |
| 外层过程标题        | 字体                  | text-ui-control                   | DESIGN base role                                              |
| 工具输出            | 纵向上限/scroll owner | 220px/内部 overflow-y-auto        | 无上限/Transcript 唯一纵向 owner                              |
| 工具标题            | 长内容                | 单行 truncate                     | 自动换行且保留状态与操作                                      |
| Trace 披露/复制控件 | 来源/光标/复制目标    | 原生或 motion button/default/28px | 已安装 Button contextual（最小28px、可增长）/pointer/icon24px |
| 工具详情            | 参数/结果             | 无独立参数                        | 安全 typed callView 参数与返回结果分区                        |
| 过程/活动摘要       | 警示                  | 隐藏于收起内容                    | 明示实际失败/取消/拒绝，缺历史时间明确未知                    |

## 交付证据

- 当前 keyed AppConversation 通过 `useTraceReaderState` 保存外层、活动段、推理、工具、diff 的显式选择及当前完整输出页，不写入 Core、store 或持久化。消息身份关联跨 partial→commit；同时间戳的助手出现序号避免并行工具结果提交改变条目身份。生命周期只计算缺省值，不再 effect 强制重开或收起。
- Required scenarios 全部已审计：原 chronological 正文顺序、单行实时预览/结算类别、真实时长与未知历史、默认失败/中止、显式选择/选区/焦点、并行逆序与复用 ID、原位置拒绝与单审批、分页/diff/ANSI/空/缺失/渲染失败、虚拟回收/阅读锚点/实时边缘、主题/420/低高度/18px/zh-en/减少动态效果。公开 App/wire 和 ToolRow 回归在真实 Chromium 中验证；输入/输出只采用 typed presentation 值，没有新增 raw args 预览。
- 失败先行：partial 提交丢失选择、并行结果插入使 partial 身份移动、未知历史合成时长/缺失工具结果假运行、长输出与 diff 内滚动、无效 diff 崩溃、Trace 默认光标，均保存 RED→GREEN 证据。原子参数/结果分区、真实分页引用与 diff 展开选择在虚拟行回收后保持。
- 局部最终证据：`transcript`、`tool-output`、`conversation-dock`、`plan-review` 共 4 文件 32 条通过（10.55s）；store 5 条通过（271ms）；Project 菜单独立 6 条通过（2.51s），与 Transcript 配对 24 条通过（10.58s）。`check:dev` 完整通过；其后 4 个 Trace 控件复用第 05 票同源 Button 转换，仅增量复验受影响 32 条、类型、lint、格式和文档，未重复整包。
- 本票唯一一次 `bun run test:desktop` 实际为 **370 通过、1 失败，23.07s**（63 文件通过、1 文件失败）。唯一失败在 Project 菜单 Shift+F10 焦点场景；单独和配对均未复现，未找到本票共享 focus effect 的因果路径，**整包结果保留失败，不能由局部通过改写为整包通过**。此 suite-only 焦点限制留给最终 review 评估，未改菜单实现或弱化断言。
- agent-browser 使用隔离 launcher、memory 加密和 loopback fake provider，真实 Core Run 收到推理、两条并行命令、独立成功/exit7 失败和工具结果续传后的最终正文。逐张允许两次审批；Light/Dark 1280×900、Dark 420×480 与 420×900 截图及 computed geometry 均无横向溢出/Trace 内纵向滚动；披露与子图标 pointer、复制 24×24、长命令自动增长；Space/Enter、收起后警示/正文、真实完整输出读取可用。错误日志为空，资源请求 200。外部 fixture 还向标题请求返回了工具，导致 sidecar 记录 Title model stopped: toolUse，标题使用 prompt 回退；不把这记为标题模型验收通过。
- 当前源码确认来自本票工作树 @fs；Chromium 通过 localhost→127.0.0.1 resolver 映射避开无关 IPv6 Vite。关闭本票浏览器、launcher 和 fake provider 后，进程及端口均已观察退出；其他任务早先的隔离目录与用户 IPv6 dev server 保留。
- 复用已安装 beUI AgentActivity、ToolResult、FileDiff 与 Button，未安装新组件或依赖。README 已同步。沿用 ADR-0029；只迁移 ui 内部呈现状态与组件适配，无新增持久化、wire 或 Core 决策，无需新 ADR。
- 完整命令、源状态、原失败与增量证据位于协调目录 `verification-07.md` 及 `07-*.log`；root 负责 PR 和最终 review，不自动 merge。
