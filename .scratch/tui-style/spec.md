Status: ready-for-agent

# Spec: TUI 样式与四层组件结构

## Problem Statement

`neant` 的交互界面已经能用，但样式很简陋：颜色都是写死的 `"red"` 和 `dimColor`，权限对话框没有任何视觉层次，工具调用和消息靠 `>`、`✓` 这类 ASCII 符号区分，启动时也没有任何标识。所有 UI 挤在 `conversation/index.tsx` 一个 331 行的文件里，状态逻辑和展示混在一起，很难单独调某一块的样式。我想让它看起来像 dsh-TUI（也就是 Claude Code 那种风格），并按 dsh-TUI 的四层设计重新组织组件，这样以后调样式、换主题、加新区域都有固定的位置。

## Solution

参照 dsh-TUI 的四层设计，按"是否懂业务"划分包边界：

| 层             | 位置                                    | 职责                                 |
| -------------- | --------------------------------------- | ------------------------------------ |
| ① 渲染器原语   | `packages/tui/src/components/`          | 宿主元素与行为包装，不知道主题和业务 |
| ② 设计系统原语 | `packages/tui/src/design-system/`       | 主题与主题感知的通用零件，只依赖 ①   |
| ③ 应用组件     | `apps/neant-tui/src/components/<区域>/` | 具体 UI 区域，只接收 props           |
| ④ 屏幕         | `apps/neant-tui/src/screens/chat/`      | 接 Session，持有状态，把数据喂给 ③   |

`@neant/tui` 仍然不依赖 `@neant/agent`。视觉直接对齐 dsh-TUI 深色主题（"雾蓝"配色）。

## User Stories

1. 作为用户，我想在启动 `neant` 时看到一个带渐变色的 NEANT 大字标题，下面一行显示 model 和 cwd，这样一眼知道当前在用什么。
2. 作为用户，我想让我的消息以 `❯` 开头，assistant 的回复以 `⏺` 开头（非 macOS 是 `●`），这样能快速区分谁说的话。
3. 作为用户，我想让工具调用显示状态点：运行中是 spinner，完成是 success 色的 `•`，失败是 error 色的 `✗`，结果以 `⎿` 引出，这样一眼看出工具做到哪一步。
4. 作为用户，我想让 compaction、MCP 这类提示用 warning 色显示，run 错误用 error 色显示，这样不会和正常回复混在一起。
5. 作为用户，我想让权限对话框顶部有一条 permission 色的分隔线，聚焦的选项是 accent 色加粗并带 `❯` 指针，底部有按键提示，这样授权时不会看错选项。
6. 作为用户，我想让输入框上下各有一条 promptBorder 色横线、前缀是 `❯`，这样输入区和对话历史分得开。
7. 作为用户，我想让状态栏用 subtle 色显示 model 和 token 用量，Running 时状态词变成 accent 色，这样能看出 agent 是否在工作。
8. 作为用户，我想让 spinner 用 `·•●•` 帧，和整体风格一致。
9. 作为在 `NO_COLOR` 环境下使用的用户，我想让 `neant` 不输出任何颜色转义，这样日志和不支持颜色的终端都能正常显示。
10. 作为维护者，我想让 ③ 层组件只接收 props、不碰 Session，这样能直接喂数据测试和调样式。
11. 作为维护者，我想让颜色都通过主题 token 引用（如 `color="permission"`），这样以后加第二套主题只需要加一张 token 表。
12. 作为 `@neant/tui` 的使用者，我想直接用 `Divider`、`ListItem`、`StatusIcon`、`HintLine` 这些主题感知的零件，这样别的 Bun 前端也能复用同样的视觉。

## Implementation Decisions

### ① 渲染器原语（`packages/tui/src/components/`）

只补现有 UI 用得到的能力：

- `Text` 新增 `inverse`、`italic`（SGR 7 / 3），贯通 `screen/` 的 cell 样式与差分。
- 设置了 `NO_COLOR`（非空）时不输出任何颜色 SGR，粗体等非颜色样式照常输出。
- `Spinner` 新增 `frames?: string[]` prop，默认值保持现有 braille 帧不变。
- 不做：round 边框、`borderColor`、`backgroundColor`、256/16 色降级、`RawAnsi`。

### ② 设计系统（`packages/tui/src/design-system/`）

- `theme.ts`：`Theme` 类型和唯一的 `dark` 主题，共 10 个 token，取值照搬 dsh-TUI `src/theme.ts` 的 darkTheme：

  | token          | 值        | 用途                           |
  | -------------- | --------- | ------------------------------ |
  | `text`         | `#E8E6E0` | 正文                           |
  | `subtle`       | `#5E6673` | 次要信息（代替 dimColor）      |
  | `accent`       | `#7DA1DE` | 聚焦项、assistant `⏺`、Running |
  | `permission`   | `#ABC2EC` | 权限对话框 Divider 与标题      |
  | `success`      | `#82B89D` | 工具完成 `•`                   |
  | `error`        | `#DA8A93` | 工具失败 `✗`、run 错误         |
  | `warning`      | `#D8B270` | notice                         |
  | `promptBorder` | `#55606F` | 输入框上下横线                 |
  | `logoFrom`     | `#7DA1DE` | logo 渐变起点（dsh accent）    |
  | `logoTo`       | `#D7E4FF` | logo 渐变终点（dsh `PALE`）    |

- `ThemeProvider` + `useTheme()`：context 提供当前主题，不传时默认 `dark`。不做 OSC 11 背景探测、auto 模式和热切换。
- `ThemedText` / `ThemedBox`：`color` 接受 token 名（`keyof Theme`），解析成 hex 后交给 ①。也接受原始颜色值，便于逐格渐变。
- 零件：
  - `Divider`：一行 `─` 铺满宽度，可带标题，可传 `color` token。
  - `ListItem`：聚焦时 `❯` 指针 + accent 加粗，未聚焦时两格空白。
  - `StatusIcon`：`status: "running" | "success" | "error"`，running 渲染 Spinner（`·•●•`），success 是 `•`，error 是 `✗`。
  - `HintLine`：subtle 色的一行按键提示。
- 字形常量（`⏺`/`●`、`❯`、`⎿`、`•`、`✗`、spinner 帧）集中放在 `design-system/figures.ts`，`⏺` 按 `process.platform === "darwin"` 选择。
- 从 `@neant/tui` 的 `index.ts` 导出以上全部。

### ③ 应用组件（`apps/neant-tui/src/components/<区域>/`）

每个区域一个目录，通过各自的 `index.ts` 暴露，由 `components/index.ts` 统一收口。组件只接收 props，不 import `@neant/agent`。

- `logo/`：NEANT 大字 + 一行 `model · cwd`（subtle 色）。
  - 从 dsh-TUI 拷贝 `src/components/bigfont.ts`、`splashFonts.ts` 中的 `bold` 一套字体、`Spinner/spinnerUtils.ts` 中的 `interpolateColor`，文件头注明来源路径（做法同 ADR-0005）。
  - 把 `renderBigText` 改写成输出 `{ ch, color: "#rrggbb" }[][]`（5 行），去掉扫光（`time`/`flash`/`stepMs`）参数，只保留 `logoFrom → logoTo` 的横向渐变。
  - 每行一个 `<Box flexDirection="row">`，相邻同色字符合并成一个 `<ThemedText color>`。
- `user-message/`：`❯ text`。
- `assistant-message/`：accent 色 `⏺` + 文本；流式中的文本和已完成的消息共用这个组件。
- `tool-call/`：`StatusIcon` + 工具摘要，有结果或错误时在下一行以 `⎿` 引出（错误用 error 色，最多 3 行）。
- `notice/`：`kind: "info" | "error"`，info 为 warning 色（compaction、MCP），error 为 error 色（run 错误）。
- `permission-dialog/`：顶部 permission 色 `Divider`（标题 `权限确认`），工具名与参数一行，三个选项用 `ListItem`，底部 `HintLine`。
- `prompt-input/`：上下两条 promptBorder 色 `Divider`，中间 `❯ ` + `TextInput`。
- `status-line/`：subtle 色一行 `model · input N · output N · 状态`，Running 时状态词为 accent 色。

### ④ 屏幕（`apps/neant-tui/src/screens/chat/`）

- 现有 `conversation/` 的 `reduceEvent`、`replayMessages`、`createConversation` 和 `permissions/` 的 `createPermissions` 迁入 `screens/chat/`，作为该屏幕私有的状态模块。`apps/neant-tui/src/conversation/` 和 `permissions/` 目录删除。
- `Chat` 组件订阅 Session、会话 store 和权限队列，组织 Static 历史（首项为 logo）与底部活动区，把数据作为 props 传给 ③。
- `main.tsx` 改为渲染 `<ThemeProvider><Chat /></ThemeProvider>`。

### 仓库

- CLAUDE.md：
  - "一个概念一个目录"限定为 `packages/agent`。
  - 新增规则：UI 包按四层组织（① `components/` → ② `design-system/` 在 `@neant/tui`；③ `components/<区域>/` → ④ `screens/` 在 app），依赖只能向下，③ 按 UI 区域分目录并经 `index.ts` 收口。规则只写在文档里，不加 lint 或测试检查。
  - Repo layout 更新为 `packages/tui/src/{components,design-system,...}`、`apps/neant-tui/src/{components,screens}/`。
- 不写新 ADR，不改 CONTEXT.md。

## Testing Decisions

- 沿用现有 seam：`render(<组件>, { stdin, stdout })` + `@xterm/headless` 读回 cell 的字符与样式。
- ① 层新能力各写单元测试（`packages/tui/tests/`）：
  - `inverse`、`italic` 产生对应的 SGR，且帧差分在样式变化时会重写该 cell。
  - `NO_COLOR` 下 `color="#..."` 不产生颜色 SGR，`bold` 仍生效。
  - `Spinner` 传 `frames` 时按给定帧循环，不传时仍是 braille。
- ② 层：`ThemedText` 把 token 解析成主题里的 hex（读回 cell 的前景色）。
- ③ 层只写一条冒烟测试（`apps/neant-tui/tests/components/`）：`PermissionDialog` 渲染出 `─` 分隔线，聚焦项为 accent 色加粗。
- logo：一条测试断言首列和末列颜色分别等于 `logoFrom`、`logoTo`，相邻同色合并为同一段。
- 其余视觉靠人工运行 `neant` 确认。不做整屏快照。
- 迁移到 `screens/chat/` 后，现有 neant-tui 的 e2e 与 reducer 测试必须继续通过（只改 import 路径和断言里变化的字形）。

## Out of Scope

- markdown 渲染、代码高亮、diff 视图。
- 多主题、light 主题、OSC 11 背景探测、运行时切换主题、用户自定义主题。
- 256 色 / 16 色降级（hex 一律 truecolor 输出，`NO_COLOR` 除外）。
- logo 扫光动画、鲸鱼动画、随机字体与 splash 彩蛋、tips。
- round 边框、`borderColor`、`backgroundColor`、`RawAnsi`。
- 层间依赖的自动检查（lint 或 import 扫描测试）。

## Further Notes

- 参考源：`/Users/artorias_chan/Workspaces/agent/dsh-TUI`。主题见 `src/theme.ts` 的 darkTheme，字形见 `src/terminal-utils/figures.ts`，权限对话框见 `src/components/approvals/ApprovalPanel.tsx`，工具调用见 `src/components/messages/AssistantToolUseMessage.tsx`。
- logo 只是占位，之后会替换成正式 logo；替换时只动 `components/logo/`。
- 拷贝代码的许可风险同 ADR-0005：dsh-TUI 为 MIT，但来源未完全确认；对外分发前需复核。
