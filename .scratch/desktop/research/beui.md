# 研究：shadcn/beui 组件库

回答 [07: shadcn/beui 组件库](../issues/07-research-beui.md)。调查时间 2026-10-09，来源均为一手：beui.dev 站点与 registry 端点、GitHub 仓库 API、shadcn 官方 registry 目录、npm registry。

## 结论

- “shadcn/beui”应指 beUI（beui.dev）。它是一个通过 shadcn CLI 分发、基于 Motion + Tailwind v4 的第三方组件 registry，不是 shadcn 官方子项目，也不是 shadcn 的 Base UI 变体。有一个需要用户确认的歧义，见下文“歧义”一节。
- 与 shadcn 的关系：并用。beUI 依赖 shadcn 的语义 token 和 CLI，本身不提供 Button/Dialog 这类 shadcn 基础原语的同名替代，而是自带一套 Motion 版组件。
- 与 ai-elements 的关系：功能高度重叠（消息、输入框、代码块、工具调用、确认）。两者可以并存，但在同一个界面里混用，会出现两套视觉语言、两套高亮器和两套 Markdown 方案。应二选一作为 Agent 界面层。
- 兼容性：React 19、Tailwind v4 的要求满足；没有 Next.js 运行时依赖，可以在 Vite 8 下使用。不过上游只在 Next.js 16 中验证过，Vite 8 未经上游验证。
- MVP 覆盖：消息、流式跟随滚动、输入框、代码块、工具结果、权限确认、侧边栏都有现成组件。缺 Markdown 渲染，这一项本来就由 tech-stack 里的自研 micromark 方案负责。另外需要处理 i18n 文案和 Shiki 语言集。

## 项目身份

| 项              | 值                                                                                                             | 来源                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 名称            | beUI，“Animated Components for React and Next.js”                                                              | beui.dev 首页 `<title>` 与 meta description                                                       |
| Registry        | `https://beui.dev/r/{name}.json`，目录 `https://beui.dev/registry.json`（`$schema` 为 shadcn registry schema） | [registry.json](https://beui.dev/registry.json)、[Agent guide](https://beui.dev/docs/ai-agents)   |
| shadcn 命名空间 | `@beui`，已收录进 shadcn 官方 registry 目录                                                                    | [ui.shadcn.com/r/registries.json](https://ui.shadcn.com/r/registries.json) 中的 `"name": "@beui"` |
| 仓库            | [github.com/starc007/ui-components](https://github.com/starc007/ui-components)，homepage 指向 beui.dev         | GitHub API `repos/starc007/ui-components`                                                         |
| 维护者          | Saurabh（GitHub `starc007`），提交 536 次；其他贡献者均不超过 13 次                                            | 仓库 `package.json` 的 author 字段、contributors API                                              |
| 活跃度          | 2024-01-31 创建，最后推送 2026-10-06，1753 star、90 fork、8 个 open issue，未归档；10 月 5–6 日连续合并功能 PR | GitHub API repo 与 commits                                                                        |
| 许可证          | MIT                                                                                                            | GitHub license API，[LICENSE](https://github.com/starc007/ui-components/blob/main/LICENSE)        |
| 商业版          | 另有 `pro.beui.dev` 付费版，免费 registry 中的组件为 MIT                                                       | beui.dev 首页导航和页脚链接                                                                       |

规模：registry 共 138 项，均为 `registry:component`，分为 motion、blocks、charts、agents 四类。站点侧栏显示 AI Agents 类有 18 个组件（来源：registry.json、[/docs/theme](https://beui.dev/docs/theme) 侧栏）。

### 歧义

“beui”可能对应以下几种解读：

1. beUI（beui.dev，starc007）：首选。它是唯一名为 beui、且挂在 shadcn 生态下的项目，有专门的 Agents 组件分类，和 Rukie 的需求吻合。
2. shadcn 的 Base UI 底座（`base-nova`、`base-vega` 等 preset，底层是 `@base-ui/react` 1.8.0）：shadcn 现在可以选 Radix、Base 或 Aria 作为底座（来源：[ui.shadcn.com/r/config.json](https://ui.shadcn.com/r/config.json)）。如果用户说的是“shadcn + Base UI 默认风格”，“beui”就可能是 “base ui” 的口误。这种情况下结论会变成：shadcn（Base 底座）+ ai-elements，beUI 不参与。
3. 名称相近但无关的包：`@be-ui/pc`、`@be-ui/mobile`（中文 PC/移动组件库）、`noist-beui`（Vue 3）、`react-be-ui`（Headless UI）。它们与 shadcn 都没有关系，可以排除（来源：npm search `beui`）。

需要用户确认：是指 beui.dev，还是 shadcn 的 Base UI 底座。下面的分析都按 beui.dev 进行。

## 与 shadcn CLI 的关系

- 分发：使用 shadcn CLI，命令为 `npx shadcn@latest add @beui/<name>` 或 `npx shadcn@latest add https://beui.dev/r/<name>.json`。源码会拷贝进项目，属于 copy-paste 模式（来源：[Agent guide](https://beui.dev/docs/ai-agents)）。
- 主题：“beUI components style themselves with shadcn semantic tokens”。推荐先执行 `npx shadcn@latest init`，也可以直接粘贴 `/theme.css`。beUI 在 shadcn token 之外还扩展了 `--border-strong`、`--neon`、`--glass-*` 等变量，并且要求 Tailwind v4（来源：[/docs/theme](https://beui.dev/docs/theme)）。
- 默认风格：beUI 的默认风格就是 `/theme.css`，即中性灰阶、`--primary: #0285f7` 蓝色，加玻璃质感 surface 和 Motion 弹簧动效。
- 依赖：在所有 registry 项中，`registryDependencies` 都为空，也就是不引用 shadcn 官方组件。依赖只有 npm 包：clsx（137 项）、tailwind-merge（137）、motion（135）、lucide-react（59）、@floating-ui/dom（15）、shiki（5）、@tanstack/react-virtual（4）、lenis（3）、next-themes（1）、@paper-design/shaders-react（1）。各组件的 Button、Select、Popover、Checkbox 都是 beUI 自己写的 Motion 实现（来源：registry.json 统计结果、`prompt-input` 和 `approval-card` 的文件列表）。
- 结论：beUI 只借用 shadcn 的 token 和 CLI，组件层与 shadcn 原语并列存在，不是在其上叠加。项目可以同时装 shadcn 原语和 beUI 组件，但两边会各有一套 Button、Select 等基础控件。

## 与 ai-elements 的关系

ai-elements（Vercel，[vercel/ai-elements](https://github.com/vercel/ai-elements)，Apache-2.0，2480 star，最后推送 2026-09-01）也是 shadcn registry，命名空间为 `@ai-elements`（来源：shadcn registries.json）。

| 维度     | beUI agents                                                                                   | ai-elements                                                                                             |
| -------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 基础原语 | 自带 Motion 版                                                                                | 依赖 shadcn 官方组件（button、collapsible、dialog、command 等，见 `all` 项的 `registryDependencies`）   |
| 数据模型 | 纯 props/ReactNode，与传输层无关                                                              | `message`、`tool`、`confirmation`、`prompt-input` 都依赖 `ai` 包（AI SDK 的 UIMessage/ToolUIPart 类型） |
| Markdown | 不提供；`StreamingResponse` 的注释写明 “Pass plain text or the output of a Markdown renderer” | 内置 streamdown（附带 @streamdown/code、math、mermaid、cjk 插件）                                       |
| 代码高亮 | shiki（`createHighlighter`，固定 5 种语言）                                                   | shiki                                                                                                   |
| 滚动跟随 | 自研 `MessageScroller`（`followOutput`）                                                      | `use-stick-to-bottom`                                                                                   |

来源：`https://ai-sdk.dev/elements/api/registry/{message,conversation,code-block,tool,confirmation,prompt-input,reasoning,all}.json`，以及 beUI `/r/*.json` 中的源码。

判断：两者都覆盖 Agent 界面层，应选一个作为主体，不建议混用。

- 选 beUI：替换 tech-stack 中的 ai-elements，同时保留 shadcn token 和 CLI；Markdown 继续走自研 micromark 方案，beUI 本身也没有这一项。另一个好处是它不依赖 `ai` 包，Rukie 的 wire 协议不必适配 AI SDK 的消息类型。
- 保留 ai-elements：beUI 只能作为零散的动效组件补充，“beUI 默认风格”就无从谈起。

如果用户的意思是 beui.dev 默认风格，tech-stack 中“组件原语”一行应改为“shadcn（token/CLI）+ beUI”，并移除 ai-elements。这属于决策，留给工单处理。

## 兼容性

| 目标             | 结论               | 证据                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React 19.3       | 兼容（推断）       | 上游依赖 `react ^19.0.0`、`@types/react ^19.0.7`；`motion` 最新版 14.0.0 的 peer 为 `^18 \|\| ^19`。没有找到 19.3 的专门测试记录                                                                                                                                                                                                                  |
| Tailwind CSS 4.3 | 兼容               | 上游 `tailwindcss ^4.0.0`，主题文档明确 “Requires Tailwind CSS v4”，使用 `@theme inline` 和 `@custom-variant dark`。npm 上 tailwindcss 最新为 4.3.3，与 tech-stack 一致                                                                                                                                                                           |
| Vite 8           | 可用，但上游未验证 | 抽查 message、chat-app、streaming-response、tool-approval、code-block、prompt-input、message-scroller 及其依赖文件，均没有 `next/*` import，只有 `"use client"` 指令，Vite 下会被忽略。路径别名使用 `@/components`、`@/lib`，需要在 Vite 和 tsconfig 里配置。上游站点本身是 Next 16.3.8，只有 next-themes（theme-toggle）这一个组件依赖 Next 生态 |
| Electron/离线    | 需注意             | `agent-code.tsx` 在运行时调用 `createHighlighter`，加载 bash、diff、json、tsx、typescript 五种语言及 github high-contrast 主题；其他语言需要改源码                                                                                                                                                                                                |

## MVP 组件覆盖

| MVP 需求       | beUI 组件                                                                                                                                                          | 覆盖与缺口                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 聊天消息       | `message`、`message-bubble`                                                                                                                                        | 有，可组合消息行和分组气泡                                                                            |
| 流式与滚动跟随 | `message-scroller`（`followOutput`、`busy`、`onFollowChange`、消息导航 rail）、`streaming-response`（完成后的操作按钮）                                            | 有。跟随与离开底部的语义与 ADR-0006 的 bottom-follow 思路一致                                         |
| 流式 Markdown  | 无                                                                                                                                                                 | 缺。`StreamingResponse` 只接收 `children`，需要接入自研 micromark→React 渲染器（tech-stack 已有规划） |
| 代码块         | `code-block`（shiki，标注支持流式稳定更新和行号）                                                                                                                  | 有，但语言集固定为 5 种                                                                               |
| 工具调用       | `tool-result`（终端输出）、`agent-activity`（推理、搜索、工具调用活动流）、`file-diff`、`todo-list`                                                                | 有，覆盖较全                                                                                          |
| 权限确认       | `tool-approval`（状态含 pending/approving/approved/denied/running/complete/error，回调有 `onApprove`/`onAlwaysAllow`/`onDeny`）、`approval-card`（单选或多选决策） | 有，与 Rukie 的 allow once/always/deny 基本对应                                                       |
| 侧边栏         | `ai-sidebar`（文件夹、项目、文件）、`animated-sidebar`                                                                                                             | 有                                                                                                    |
| 输入框         | `prompt-input`（自动增高、模型选择、发送和停止）、`attachment-upload`                                                                                              | 有                                                                                                    |
| 整体骨架       | `chat-app`（组合了侧边栏、消息、输入框、审批、diff 等）                                                                                                            | 可作为主窗口布局参考，最终布局以 Pencil 视觉稿为准                                                    |
| 对话框         | `morphing-modal`、`center-morph-modal`、`drawer`、`popover`                                                                                                        | 有                                                                                                    |

主要缺口：

- i18n：组件内的英文文案是硬编码的。例如 tool-approval 的 `getStatusCopy` 返回 "Approval required"、"Denied" 等；prompt-input 中有 "Send prompt"、"Stop generating"、"Add to prompt" 等 aria-label；code-block 中有 "Copy code"。部分文案可以通过 props 覆盖，状态文案则要改源码。由于是 copy-paste 模式，源码在项目内，按 ADR-0008 接入 zh/en 即可。
- 重复依赖：多个组件各自内联同名的 helper（`lib/utils.ts`、`ease.ts`、`button/*`）。用 shadcn CLI 安装时，这些文件会落到同一路径。

## 未验证

- 没有实际执行 `shadcn add` 并在 Vite 8 + React 19.3 下完成构建，兼容性结论来自依赖声明和源码 import 抽查。
- 没有逐一核对 registry 全部 138 项是否都不含 `next/*` import，只抽查了 MVP 相关组件及其依赖文件。
- 没有评估 Motion 动效对长 Transcript 渲染性能的影响，也没有评估无障碍（a11y）的实际表现。
