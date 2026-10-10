# 研究：beUI 在 Vite 8 与 Tailwind 4 下的安装与改写面

回答 [工单 15](../issues/15-research-beui-install.md)。版本基线：Vite 8.3.1、@vitejs/plugin-react 6.1.2、React 19.3.0、Tailwind CSS 4.3.3（@tailwindcss/vite 4.3.3）、TypeScript 6.0.3、Bun 1.4.2、shadcn CLI 4.21.4、oxlint 1.86.0（仓库锁定版本）。beUI registry 为 2026-10-10 的线上版本（140 项）。

来源分三类：2026-10-10 在 macOS arm64 上的临时项目实验（标“实测”）；beUI registry 端点 `https://beui.dev/r/{name}.json`、`https://beui.dev/theme.css` 与安装后的组件源码；oxlint 1.86.0 自带的 `configuration_schema.json`。没有打开浏览器检查渲染效果，也没有运行交互测试。

## 结论

1. 能构建（实测）。在 Vite 8.3.1 + React 19.3.0 + Tailwind 4.3.3 下，`shadcn init -t vite -b radix` 后执行 `shadcn add @beui/<name>`，一次装了 23 个 beUI 组件（共 65 个文件）和 shadcn `dropdown-menu`，`tsc -b && vite build` 通过。前提是改一处 CLI 引入的错误：CLI 把 `@/lib/text-shimmer` 的 import 改写成 `@/components/motion/text-shimmer`，导致自引用，涉及 2 个文件。
2. 角色分配：按钮、popover、tooltip、命令面板、模态框、抽屉、select 和全部 Agent 反馈组件都由 beUI 提供。beUI 没有点击触发的下拉菜单（`context-menu` 只响应右键、长按或 ContextMenu 键；`bloom-menu` 只接收 `label` 列表，没有 `role="menu"` 和方向键支持），所以会话、项目、账户、权限模式这些菜单用 shadcn `dropdown-menu` 补位。
3. 依赖：beUI 引入 `motion` 14.1.0、`clsx` 2.1.1、`tailwind-merge` 3.7.0、`@floating-ui/dom` 1.8.0、`shiki` 4.5.0、`lucide-react`。`shadcn init` 和 `dropdown-menu` 另外引入 `radix-ui` 1.7.0、`class-variance-authority` 0.7.1、`cn` 0.4.0、`tw-animate-css` 1.4.0，以及 `shadcn` 4.21.4（作为运行时依赖，用于 `shadcn/tailwind.css`）。CLI 写入的都是 `^` 范围，需要手动改成精确版本；`@fontsource-variable/geist` 不需要，删掉。
4. 主题：beUI registry 项不携带 `cssVars`/`css`，主题全部来自项目 CSS。按 DESIGN.md 的 Themes 表，用 GitHub 值替换 beUI `theme.css` 中的同名变量即可；`--glass-*`、`--neon` 只是变量值不同。实测中，已安装组件都没有使用 `glass` 工具类，浮层表面直接用 `bg-popover`/`bg-card`。另有 7 个 Agent 组件硬编码了 `emerald/rose/blue/amber` 调色板，共 68 处，需要改为语义 token。
5. `text-ui-*`：在 `@theme inline` 中声明 `--text-ui-*` 与 `--text-ui-*--line-height`，就能生成标准字号工具类（实测）。这里有一个阻断问题：beUI 的 `cn()`（clsx + tailwind-merge）和 shadcn 的 `cn` 包，在默认配置下都会把 `text-ui-sm` 当成颜色类，与 `text-muted-foreground` 一起出现时会把它删掉（实测）。必须使用 `extendTailwindMerge`，并让 shadcn 组件也改为引用同一个 `@/lib/utils`。
6. 改写规模（实测，统计 24 个组件、68 个文件）：字号类 100 处，分布在 30 个文件中；其中 89 处可按 DESIGN.md 对照表等值机械替换（`text-sm/xs/base` 与 `text-[10px]`），11 处需要判断（`text-[11px]` ×7、`text-[13px]` ×1、`text-[0.9em]` ×2、`text-[0.8rem]` ×1），另有 loader 的内联 `fontSize` ×3。硬编码英文文案约 90 条不重复短语，分布在 24 个文件中，集中在 `approval-card`、`tool-approval`、`bloom-menu`、`todo-list`、`agent-activity`、`command-palette`。
7. Markdown 接入点：把 `StreamingResponse` 和 `MessageBubble` 的 `children` 设为自研 micromark→React 渲染器的输出。两者已经用 `[&_code]`、`[&_pre]`、`[&_ul]` 等后代选择器给 Markdown 元素定了样式，但没有标题字号；应由渲染器按 DESIGN.md 的类型角色直接输出 `text-ui-*` 类，而不是依赖这些选择器。代码块交给 beUI `CodeBlock`。
8. lint：可以做。在 oxlint 1.86 `jsPlugins` 上写一个约 25 行的本地规则，检查所有字符串和模板字面量里的 `text-(xs|sm|base|lg|xl|Nxl)`、`text-[<长度>]` 以及对象属性 `fontSize`；实测能命中全部 100 处和 3 处内联字号，不误报 `text-ui-*`、`text-[var(--x)]`、颜色类，在 68 个文件上耗时约 0.1 秒。`jsPlugins` 在 1.86 中标记为 alpha，不受 semver 保护。如果要避开这个风险，可以用同一个正则写成 `scripts/check-*.ts`，接入 `check:dev`（仓库已有 `check-ink-boundaries.ts` 等先例）。

## 实验过程（实测）

临时项目 `/tmp/rukie-research-15-vite`，用手写 `package.json` 精确固定 Vite/React/Tailwind 版本，再依次执行：

1. `bunx --bun shadcn@latest init -t vite -b radix -p nova -y`：写入 `components.json`（`style: radix-nova`，别名 `@/components`、`@/lib/utils`、`@/components/ui`、`@/lib`、`@/hooks`）、`src/components/ui/button.tsx`、`src/lib/utils.ts`（内容为 `export { cn } from "cn"`），并改写 `src/index.css`（共 125 行：引入 `tw-animate-css`、`shadcn/tailwind.css`、Geist 字体，以及 oklch 中性色板）。不带 `-p` 时会进入交互式 preset 选择，非 TTY 下会卡住。
2. `bunx --bun shadcn@latest add @beui/button-base @beui/popover @beui/tooltip @beui/command-palette @beui/context-menu @beui/center-morph-modal @beui/morphing-modal @beui/drawer @beui/select @beui/streaming-response @beui/thinking-shimmer @beui/reasoning-text @beui/agent-activity @beui/agent-progress @beui/tool-result @beui/tool-approval @beui/approval-card @beui/message @beui/message-scroller @beui/prompt-input @beui/code-block @beui/todo-list @beui/file-diff -y -o`：`components.json` 中自动加入 `"@beui": "https://beui.dev/r/{name}.json"`，创建了 64 个文件。不加 `-o` 时，会因为 `src/lib/utils.ts` 已存在而停在覆盖确认提示。加 `-o` 后，`utils.ts` 被换成 beUI 的 clsx + tailwind-merge 版本，而 init 生成的 shadcn `button.tsx` 仍然直接 `import { cn } from "cn"`。
3. `bunx --bun shadcn@latest add dropdown-menu @beui/bloom-menu -y`：新增 2 个文件，没有新增 npm 依赖。`dropdown-menu.tsx` 同样直接引用 `cn` 包。
4. 构建前需要处理两个问题：TypeScript 6 把 `baseUrl` 视为弃用错误（TS5101），shadcn 文档里的 tsconfig 不能写 `baseUrl`，只保留 `paths`；CLI 的 import 改写错误（见下）。处理后 `tsc -b && vite build` 通过。演示入口引用了全部已安装组件，生成的 JS 主块为 820 kB（gzip 262 kB）。

安装过程中，有两次 registry 请求以 TLS 错误失败，重试后成功。CI 或无人值守环境里安装组件需要重试机制。

### CLI 的 import 改写错误（实测）

registry 中 `components/motion/text-shimmer.tsx` 与 `lib/text-shimmer.ts` 同名不同目录。CLI 写入时，把 `from "@/lib/text-shimmer"` 改写成了 `from "@/components/motion/text-shimmer"`，结果 `text-shimmer.tsx` 自己 import 自己，`reasoning-text.tsx` 也指向了错误模块，`tsc` 报 TS2303/TS2459。逐个对比 registry 源码与落盘文件的 `@/` import，在 65 个文件中只有这 2 处被改写。另外 4 个共享文件（`button/base.tsx`、`select.tsx`、`message-scroller.tsx`、`thinking-shimmer.tsx`）在不同 registry 项中的版本只差首行注释，后装的会跳过或覆盖，对行为没有影响。

结论：每次 `shadcn add @beui/...` 之后都要跑 `tsc -b`，并检查 diff 中的 `@/lib/*` import。这个问题值得向 shadcn 上游报告。

### shiki 体积（实测）

`agent-code.tsx`（被 `code-block`、`tool-result`、`tool-approval`、`file-diff` 共用）调用 `import { createHighlighter } from "shiki"`。这个完整入口会让 Vite 为每种语言和主题各生成一个 chunk，`dist` 共 310 个文件、11 MB。改成 `shiki/core` + `createJavaScriptRegexEngine` + `@shikijs/themes/github-{light,dark}` + `@shikijs/langs/{bash,diff,json,tsx,typescript}` 显式导入后，`dist` 降到 9 个文件、1.3 MB，构建仍通过。DESIGN.md 要求的 `github-light`/`github-dark` 主题替换也在这一处完成。扩展语言集时，同样在这个文件里加显式 import。

## 依赖清单（实测，bun.lock 解析版本）

| 包                           | 版本   | 引入方                           | 处理                                                                                                                                          |
| ---------------------------- | ------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `motion`                     | 14.1.0 | beUI 全部                        | 保留，精确固定                                                                                                                                |
| `clsx`                       | 2.1.1  | beUI `lib/utils.ts`              | 保留，与 tech-stack 一致                                                                                                                      |
| `tailwind-merge`             | 3.7.0  | beUI `lib/utils.ts`              | 保留，与 tech-stack 一致；需 `extendTailwindMerge`                                                                                            |
| `lucide-react`               | 1.55.0 | beUI、shadcn                     | CLI 装了最新版；tech-stack 当前为 1.48.0，需选定一个版本                                                                                      |
| `@floating-ui/dom`           | 1.8.0  | beUI `tooltip`                   | 保留                                                                                                                                          |
| `shiki`                      | 4.5.0  | beUI `agent-code`                | 保留，改为 `shiki/core` 细粒度导入                                                                                                            |
| `radix-ui`                   | 1.7.0  | shadcn `button`、`dropdown-menu` | 保留（dropdown-menu 补位需要）                                                                                                                |
| `class-variance-authority`   | 0.7.1  | shadcn `button`                  | 与 tech-stack 一致                                                                                                                            |
| `tw-animate-css`             | 1.4.0  | shadcn init                      | 保留：`dropdown-menu` 的 `animate-in`/`fade-in`/`zoom-in` 依赖它                                                                              |
| `shadcn`                     | 4.21.4 | shadcn init                      | 作为运行时依赖，只为提供 `shadcn/tailwind.css` 中的 `data-open`/`data-closed` 变体；可改为把这几个 `@custom-variant` 抄进项目 CSS，去掉该依赖 |
| `cn`                         | 0.4.0  | shadcn init                      | 删除：shadcn 组件改为引用 `@/lib/utils`，与 beUI 共用一个 `cn()`                                                                              |
| `@fontsource-variable/geist` | 5.3.0  | shadcn init（nova preset）       | 删除：DESIGN.md 使用系统字体栈                                                                                                                |

beUI 组件不依赖 `next/*`（全部 65 个文件 grep 结果为 0），54 个文件带 `"use client"`，Vite 会忽略这条指令。没有安装 `@beui/theme-toggle`（依赖 `next-themes`）。

## 主题 token 映射

beUI registry 项不携带 `cssVars`，主题完全来自 `https://beui.dev/theme.css`（130 行，读取于 2026-10-10）。该文件包含：

- `:root`/`.dark` 中的 shadcn 语义 token 和 beUI 扩展 token（`--border-strong`、`--accent-fg`、`--neon`、`--violet`、`--danger`、`--success`、`--warning`、`--glass-bg`、`--glass-border`、`--glass-strong-bg`、`--glass-thin-bg`）；
- `@theme inline` 中的 `--ease-out`/`--ease-in-out`/`--ease-drawer` 和 `--color-*` 映射；
- `@theme` 中的 `marquee`/`shimmer` 关键帧；
- `@layer utilities` 中的 `.glass`/`.glass-strong`/`.glass-thin`、`.scrollbar-hide`、`.mask-*`。

接 DESIGN.md 的做法（实测可构建）：

1. 结构照搬 beUI `theme.css`：`@custom-variant dark (&:where(.dark, .dark *))`、各层次和工具类原样保留，只把 `:root`/`.dark` 的值换成 DESIGN.md Themes 表中的 GitHub 值。`--glass-*` 与 `--neon` 只改值，`.glass*` 的 blur、saturate 和阴影不动，这正是 DESIGN.md 的要求。
2. 删除 `shadcn init` 写入的 oklch 色板、`--chart-*`、`--sidebar-*` 和 Geist 字体；`--font-sans`/`--font-mono` 用 DESIGN.md 字体栈。
3. 保留 `@import "tw-animate-css"` 和 `shadcn/tailwind.css`，或者手抄其中的 `data-open`/`data-closed` 变体，供 shadcn `dropdown-menu` 使用。
4. DESIGN.md 中的 `--diff-*` 以 `--color-diff-*` 暴露。

原型 `origin/prototype/desktop-main-window:prototypes/desktop-main-window/src/index.css` 用的就是这个结构，但缺少 `--neon`、`--glass-*`、`--diff-*-word`、`.glass*` 工具类、`--ease-in-out`/`--ease-drawer` 和 `shimmer` 关键帧；正式实现应以 beUI `theme.css` 为模板补齐。原型的 `--ease-out` 值（`0.23, 1, 0.32, 1`）与 beUI（`0.16, 1, 0.3, 1`）不同，以 beUI 为准。

实际安装的组件中，与 DESIGN.md 冲突的地方（实测 grep）：

| 问题                               | 规模                                                                                                                                      | 改法                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 硬编码调色板                       | 68 处，7 个文件：`approval-card` 24、`tool-approval` 16、`file-diff` 10、`tool-result` 6、`todo-list` 5、`code-block` 5、`activity-row` 2 | 状态色改为 `success`/`danger`/`warning`/`accent`；`file-diff` 的 +/− 计数与条形改为 `diff-*` token |
| `foreground`/`background` 加 alpha | 36 处（例如 `bg-foreground/[0.05]`）                                                                                                      | beUI 默认风格自带，DESIGN.md 的 “ad hoc alpha” 禁令是否覆盖它需要裁定，见待定                      |
| 内联 rgba 阴影                     | 6 处                                                                                                                                      | 属于 registry 的阴影定义，按 DESIGN.md “不发明阴影”的规则保留                                      |
| 遮罩层                             | `drawer` 为 `bg-black/40 backdrop-blur-sm`，`center-morph-modal` 为 `bg-background/10 backdrop-blur-sm`                                   | `bg-black/40` 改为 token                                                                           |
| `glass` 工具类使用                 | 0 处                                                                                                                                      | DESIGN.md 中“beUI surfaces stay as shipped: glass …”的前提与实际组件不符，见待定                   |

## `text-ui-*` 的 Tailwind 4 定义（实测）

Tailwind 4 的 `--text-*` 命名空间会生成 `font-size` 工具类，并支持 `--text-*--line-height` 子变量：

```css
@theme inline {
  --text-ui-xl: calc(var(--ui-font-size) + 4px);
  --text-ui-xl--line-height: calc(1.75 / 1.125);
  --text-ui-lg: calc(var(--ui-font-size) + 2px);
  --text-ui-lg--line-height: calc(1.5 / 1);
  --text-ui-base: var(--ui-font-size);
  --text-ui-base--line-height: calc(1.25 / 0.875);
  --text-ui-sm: calc(var(--ui-font-size) - 2px);
  --text-ui-sm--line-height: calc(1 / 0.75);
  --text-ui-xs: calc(var(--ui-font-size) - 4px);
  --text-ui-xs--line-height: 1.4;
}
```

构建产物中的写法为 `.text-ui-sm{font-size:calc(var(--ui-font-size) - 2px);line-height:var(--tw-leading,calc(1 / .75))}`；`leading-*` 仍能覆盖行高。用 `inline` 时，工具类直接展开为 `calc(var(--ui-font-size) …)`，所以在任意子树上覆盖 `--ui-font-size` 都会生效。不用 `inline` 时，Tailwind 会在 `:root` 上定义 `--text-ui-*`，计算值固定为 `:root` 的 `--ui-font-size`，只有改 `:root` 才会生效（按 CSS 自定义属性的计算规则推断，未实测）。行高取 Tailwind 内置 `text-lg/base/sm/xs` 的比例，被替换的组件行高保持原样。原型取的是 1.55/1.5/1.5/1.4/1.3，与 Tailwind 内置值不一致；DESIGN.md 没有规定行高，建议在 DESIGN.md 中写明采用 Tailwind 内置比例。

### tailwind-merge 冲突（实测，阻断项）

```text
twMerge("text-ui-sm text-muted-foreground")   → "text-muted-foreground"   // 字号被删
cn 包  ("text-ui-sm text-muted-foreground")   → "text-muted-foreground"   // 同样被删
extendTailwindMerge({ extend: { theme: { text: ["ui-xs","ui-sm","ui-base","ui-lg","ui-xl"] } } })
      ("text-ui-sm text-muted-foreground")   → "text-ui-sm text-muted-foreground"
      ("text-sm text-ui-base")               → "text-ui-base"
```

默认配置下，tailwind-merge 把未知的 `text-ui-*` 归入 text-color 组，与颜色类合并时会把它删掉。DESIGN.md 要求“次级文案配 `text-muted-foreground`”，这正是最常见的组合，所以 `cn()` 必须用 `extendTailwindMerge` 扩展 `theme.text`（tech-stack 已写明这一点，实测确认必要）。shadcn 4.21.4 生成的组件直接 `import { cn } from "cn"`，绕过了项目的 `@/lib/utils`。安装 shadcn 组件后要把这个 import 改为 `@/lib/utils`，并删除 `cn` 依赖；否则同一个界面里会有两套合并规则。

## 改写规模（实测）

统计范围：上述 23 个 beUI 项，加 `bloom-menu`、shadcn `button` 与 `dropdown-menu`，共 68 个 `.ts/.tsx` 文件。

字号：

| 原类            | 次数 | 替换为                       | 方式                                                                                   |
| --------------- | ---: | ---------------------------- | -------------------------------------------------------------------------------------- |
| `text-sm`       |   41 | `text-ui-base`               | 机械替换                                                                               |
| `text-xs`       |   33 | `text-ui-sm`                 | 机械替换                                                                               |
| `text-base`     |    5 | `text-ui-lg`                 | 机械替换                                                                               |
| `text-[10px]`   |   10 | `text-ui-xs`                 | 机械替换（等值）                                                                       |
| `text-[11px]`   |    7 | `text-ui-sm` 或 `text-ui-xs` | 不等值，需按角色判断（DESIGN.md 对照表未列出）                                         |
| `text-[13px]`   |    1 | `text-ui-base`               | 不等值，需判断                                                                         |
| `text-[0.9em]`  |    2 | Markdown 行内代码            | 改由 Markdown 渲染器输出 `text-ui-sm`（DESIGN.md：行内代码用 `text-ui-sm`）            |
| `text-[0.8rem]` |    1 | shadcn `button` 的 sm 尺寸   | 改为 `text-ui-sm`；如果按钮统一用 beUI `button-base`，可以直接删掉 shadcn `button.tsx` |
| 内联 `fontSize` |    3 | `loader.tsx` 的字符帧动画    | 属于图形尺寸而非界面文字，需要一个窄范围的 lint 例外                                   |

在临时项目里用 perl 做了一遍替换（`text-[11px]` 按 `text-ui-sm`、`text-[13px]` 按 `text-ui-base` 暂定），之后 lint 只报出 `text-[0.9em]` ×2、`text-[0.8rem]` ×1 和内联 `fontSize` ×3，构建通过。

文案：在非 shadcn 文件中，以大写开头的英文字符串字面量去重后约 90 条，分布在 24 个文件中。分类如下：

- 状态文案（`getStatusCopy` 一类函数的返回值），例如 "Approval required"、"Approving"、"Denied"、"Running"、"In progress"、"Thinking…"；
- 按钮与 aria-label，例如 "Allow once"、"Always allow"、"Deny"、"Copy code"、"Send prompt"、"Stop generating"、"Close command palette"；
- 默认 props，例如 "Type a command or search…"、"No results found."、"Ask the agent to do something…"、"Message navigation"；
- 演示用默认数据，例如 `bloom-menu` 的默认 items、`reasoning-text` 的默认短语。

一部分文案可以通过 props 传入（`placeholder`、`emptyMessage`、`closeButtonLabel`、`ariaLabel`、`activeLabel`、`label`），其余需要改源码，改为接收 `@rukie/i18n` 的 `t()` 结果或 labels 对象。`ESC`、`Enter` 这类键名也要经过 i18n，或者统一走快捷键显示函数。

## 菜单、浮层与 Markdown

| 主窗口需求（09）                             | 组件                                                                                                                              | 依据                                                                                                                                                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 纯图标按钮、主操作按钮                       | `@beui/button-base`                                                                                                               | `Button`/`ButtonLink`，带 variant/size                                                                                                                                                                                           |
| 图标按钮 tooltip                             | `@beui/tooltip`                                                                                                                   | `@floating-ui/dom` 定位，门户渲染，Esc 关闭，挂载 `aria-describedby`，默认延迟 120ms，可配 `delay`                                                                                                                               |
| 上下文用量、模型详情、Turn 预览卡            | `@beui/popover`                                                                                                                   | 门户渲染，`role="dialog"`，支持 click/hover 触发；带“goo”滤镜形变动效（`gooStrength`），在 Light/Dark 下的观感未验证                                                                                                             |
| ⌘K 搜索浮层                                  | `@beui/command-palette`                                                                                                           | 门户渲染，`role="dialog"` + `aria-modal`，listbox/option，↑↓，Esc，自带快捷键（`shortcut`）；`CommandItem` 有 group/hint/keywords/icon/badge，可承载 09 的会话行（标题、项目、更新时间）                                         |
| 会话更多、项目更多、账户、权限模式、模型列表 | shadcn `dropdown-menu`（补位）                                                                                                    | beUI `context-menu` 只能由右键、长按或 ContextMenu/Shift+F10 打开，没有子菜单；`bloom-menu` 只有 `items/onSelect(label)`，没有 `role="menu"` 和方向键。09 需要点击触发、子菜单（复制 ›、打开方式 ›、整理侧边栏 ›）、单选和勾选项 |
| 侧栏会话行右键                               | `@beui/context-menu`                                                                                                              | 有 Item/CheckboxItem/RadioGroup/Label/Separator/Shortcut，方向键和 Esc                                                                                                                                                           |
| 确认对话框（永久删除等）                     | `@beui/center-morph-modal`                                                                                                        | 焦点陷阱，关闭后焦点回到触发器，`ariaLabel` 必填，Esc 和遮罩关闭可配                                                                                                                                                             |
| 摘要窄窗口覆盖、抽屉                         | `@beui/drawer`                                                                                                                    | 受控 open，左右两侧                                                                                                                                                                                                              |
| 思考、工具活动、流式                         | `thinking-shimmer`、`reasoning-text`、`agent-progress`、`agent-activity`、`tool-result`、`streaming-response`、`message-scroller` | props 与传输层无关，见 [beui.md](beui.md)                                                                                                                                                                                        |
| 权限审批                                     | `@beui/tool-approval`                                                                                                             | `onApprove`/`onAlwaysAllow`/`onDeny` 对应 `allow`/`allow-session`/`deny`                                                                                                                                                         |

Markdown：`StreamingResponse.children` 的注释写着 “Pass plain text or the output of a Markdown renderer”；容器类名用后代选择器给 `a/code/pre/ol/ul/p+p` 定了样式，但没有给 `h1`–`h6` 定样式。`MessageBubble` 的情况相同。建议：自研 mdast→React 渲染器直接给元素加 DESIGN.md 的类型角色类（`h1` 用 `text-ui-xl`，`h2` 用 `text-ui-lg`，`h3`–`h6` 用 `text-ui-base` 配对应字重，行内代码用 `text-ui-sm font-mono`），`code` 围栏块交给 `CodeBlock`（流式时传 `status="streaming"`）。容器上的 `[&_code]:text-[0.9em]` 删除，其余间距选择器可以保留，也可以移到渲染器。

## lint：禁止非 `text-ui-*` 字号类（实测）

oxlint 1.86.0 的配置 schema 有 `jsPlugins`（“allows usage of ESLint plugins with Oxlint … JS plugins are in alpha and not subject to semver”），Bun 下可以直接加载 TS 或 JS 插件文件。在临时项目里，用仓库的 `node_modules/.bin/oxlint` 验证了一个本地规则：

```js
// Bans Tailwind font-size utilities other than text-ui-* in any string or template literal.
const BANNED =
  /(?:^|[\s"'`])(?:[\w-]+:|\[[^\]]+\]:)*!?(text-(?:xs|sm|base|lg|xl|[2-9]xl)|text-\[(?:\d*\.?\d+(?:px|rem|em|%)|length:[^\]]+)\])(?=$|[\s"'`])/g;
// visitors: Literal (string), TemplateElement (raw), Property with key fontSize
```

结果：在 68 个文件上，规则报出全部 100 处字号类和 3 处内联 `fontSize`，耗时约 0.11 秒。带变体前缀的 `hover:text-sm`、`md:text-[13px]` 也能命中；不误报 `text-ui-sm`、`text-[var(--x)]`、`text-muted-foreground`。替换后只剩 6 处需要判断的条目。

接入方式二选一：

- oxlint `jsPlugins` + `overrides.files` 限定到 GUI 包，`loader.tsx` 这类图形尺寸用行内 disable 加理由。优点是编辑器和 lint-staged 自动生效。缺点是 alpha，oxlint 升级时可能失效。
- `scripts/check-ui-font-size.ts`，用同一个正则扫描 GUI 包源码，接入 `check:dev`，和 `check-ink-boundaries.ts` 的做法一致。优点是稳定。缺点是只在 check 时运行。

两种方式都只是字符串匹配，无法识别运行时拼接出来的类名（例如 `"text-" + size`）。DESIGN.md 本来就禁止这种写法，可以接受。

## 待定

- 菜单补位：beUI 缺少点击触发的下拉菜单，这里用 shadcn `dropdown-menu` 补位，属于 AGENTS.md “beUI 未覆盖的角色用 shadcn”的情形，但需要在 tech-stack 或 DESIGN.md 中写明，避免后续再装 `bloom-menu`。shadcn 菜单的浮层表面要对齐 beUI（DESIGN.md：采用对应的 beUI 表面）。
- glass 前提：实际安装的组件不使用 `glass*` 工具类，DESIGN.md 中“beUI surfaces stay as shipped: glass …”的表述需要改为“保留工具类与 token，供用到它的组件和自定义表面使用”，或者明确哪些表面要用 glass。
- `foreground`/`background` 加 alpha 共 36 处：DESIGN.md 禁止 “ad hoc alpha fills such as `text-white/60`”，需要裁定 beUI 自带的 `bg-foreground/[0.05]` 是否属于默认风格、可以保留。
- `text-[11px]` 与 `text-[13px]` 的取舍规则需要写进 DESIGN.md 对照表。
- `lucide-react` 版本：CLI 装的是 1.55.0，tech-stack 中为 1.48.0。
- 没有在浏览器中查看渲染效果、Light/Dark 对比度和动效表现，也没有验证 popover 的 goo 滤镜在 Electron（Chromium）中的性能。
