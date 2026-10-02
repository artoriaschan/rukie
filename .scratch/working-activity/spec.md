Status: ready-for-agent

# Spec: 工作状态行（Activity Line）

## Problem Statement

`neant` 在 Run 进行中只靠状态栏里的 `Running` 一个词表示"在工作"，外加正在跑的工具前的 spinner。模型思考时、两个工具调用之间、等首 token 时都没有任何指示，用户不知道 agent 是卡住了还是在干活，也不知道已经跑了多久、花了多少 token。我想要 dsh-TUI 那样的实时工作状态行：一行带动画的文案，告诉我 agent 此刻在做什么、做了多久。

## Solution

全量移植 `dsh-working-activity`（中文部分）的文案与状态机，按 dsh-TUI `ActivityLine` 的方式渲染：输入框上方一行 `🌔 脑子在冒烟 · 总12s · ↑ 8.1k · ↓ 1.2k tokens · esc 中断`，月相帧 + 扫光文字。状态机重写为纯函数，以 Neant 的 `SessionEvent` 为输入；术语沿用 Neant/pi：原包的 turn 一律对应 **Run**。

## User Stories

1. 作为用户，我想在提交 prompt 后立刻看到"呼叫模型…"之类的等待文案，这样知道请求已经发出。
2. 作为用户，我想在模型思考时看到每 4 秒换一条的思考文案，思考越久文案越"着急"（30s / 60s / 300s 分档），深夜、周末、节日有专属文案，偶尔出稀有彩蛋。
3. 作为用户，我想在工具运行时看到动词 + 参数，如 `跑个命令 npm test · 12s`，连续调工具时显示 `工具x3`，工具刚完成时保留 2.5 秒 `✓ 读一下 src/a.ts · 87ms`。
4. 作为用户，我想看到模型自己写的一句话自述（`⏵ 查一下报错原因`）显示在状态行，而不出现在回复正文里。
5. 作为用户，我想在权限对话框打开时看到"在等你点头"，这样知道是我在挡路。
6. 作为用户，我想在 Run 结束后看到汇总行 `齐活 · 4 工具 · 想12s 干11s · 🔥 12.3k`，直到下一次提交；按 Esc 打断后看到打断接梗。
7. 作为用户，我想在行尾看到实时的 `↑ 输入 · ↓ 输出 tokens · esc 中断`，输出数在流式过程中实时增长。
8. 作为用户，我想看到 git 分支 `· git main`。
9. 作为用户，我想让状态行在窄终端下截断而不是换行把界面挤乱。
10. 作为维护者，我想让状态机是 `reduce(state, event, now)` + `render(state, now)` 纯函数，用假时钟就能测。
11. 作为 `@neant/tui` 使用者，我想要一个共享时钟的 `useAnimationFrame`，多个动画组件只用一个定时器。

## Implementation Decisions

### ① 渲染器（`packages/tui`）

- 新增共享时钟：`ClockProvider` + `useAnimationFrame(intervalMs: number | null)`，返回 `[ref, time]`，同 dsh-TUI `ink/hooks/use-animation-frame.js`。全部订阅者共用一个定时器，各自按 `intervalMs` 节流 `setTime`；无订阅者时停表。可视区检测不做（Neant 为 inline 渲染，状态行始终在底部），`ref` 预留。
- `Spinner` 改用 `useAnimationFrame`，行为和现有测试保持不变。

### ② 设计系统（`packages/tui/src/design-system`）

- `theme.ts` 新增 2 个 token：`activity: "#7DA1DE"`（dsh darkTheme `activity`）、`activityFlash: "#C6D8F8"`（dsh `shimmer.js` 的 `FLASH`）。
- 新增 `color.ts`：`rgb()` / `hex()` / `interpolateColor()` 从 `apps/neant-tui/src/components/logo/bigfont.ts` 下沉至此，logo 改为从 `@neant/tui` 引用。
- 新增 `sweep(text, time, base, highlight, stepMs = 60)`：移植 dsh `shimmer.js`，输出 `{ text, color }[]` 段（相邻同色合并），不输出 ANSI。10 列高亮窗口每 `stepMs` 前进一列，周期 `width + 20`，窗口内亮度 `(sin(time / (stepMs*2)) + 1) / 2`。宽度用 grapheme + `Bun.stringWidth`。
- `figures.ts` 新增 `activityFrames`：moon8 `🌑🌒🌓🌔🌕🌖🌗🌘`，120ms。

### ③ 应用组件（`apps/neant-tui/src/components/activity-line/`）

- `ActivityLine({ phase, line, suffix })`：
  - `useAnimationFrame(60)` 驱动。
  - 非 done：帧（tool 阶段 `accent`，其余 `activity`）+ 空格 + `sweep(line, time, base, activityFlash)` 加粗文字，base 在 tool 阶段为 `accent`，其余为 `activity`。
  - done：无帧，文字纯 `accent`；done 阶段不订阅时钟（`intervalMs = null`）。
  - `suffix` 为 `subtle` 色。
  - 整行单行截断（`wrap` 关闭，超宽末尾 `…`）。
- `status-line/`：删掉 `Running` / `Ready` 状态词及 `running` prop，只剩 `model · input N · output N`。
- `assistant-message/`：渲染前剥掉行首 `⏵` 自述行（流式和回放共用）。

### ④ 屏幕（`apps/neant-tui/src/screens/chat/`）

- `activity/`（屏幕私有模块，按需拆文件）：
  - `phrases.ts`：从 `dsh-working-activity/src/phrases.ts` 拷贝中文文案池与选择器（THINKING、30/60/300s 分档、WAITING、TOOL_OPENING、FALLBACK、FAIL、DONE、NIGHT、RARE、周末、节日 + 农历新年表、CONTINUE、COMPACT、APPROVAL、ACTION_MAP、`pickPhraseAt`、`mixSlot`、`fmtDuration` 等）。删去 en、MODEL_QUIPS、RETRY、COMPACTION_START、OVERFLOW、COMPACT_RETRY 及其他无输入来源的池。文件头保留 BSD-3-Clause 版权与许可全文，并注明来源路径与版本 `0.5.1`。
  - `activity.ts`：按 `status.ts` 重写的纯函数状态机。
    - `reduce(state, event, now)`：输入为 `SessionEvent` 加上屏幕自有事件 `submit`、`interrupt`、`approval-open` / `approval-close`、`git-branch`。
    - `render(state, now) → { phase, line, nextWakeAt }`。
    - 阶段：`idle → waiting → thinking ⇄ tool → done`。`submit` 重置 Run 统计、记 `runStartedAt` 并进入 waiting；首个 `thinking_delta` 或 `text_delta` 进入 thinking；`tool_execution_start` 进入 tool；最后一个 `tool_execution_end` 回到 thinking；`result` 进入 done，`success=false` 且已打断时走打断接梗。
    - 文案种子为 `runStartedAt`，`slot = floor((now - phaseStartedAt) / 4000)`；稀有池 7.5s 轮换，按 Run 1/150 触发，只在本 Run 第一个 thinking 阶段生效。
    - 工具动词在 `tool_execution_start` 时抽一次，done 前缀在 `result` 时抽一次。随机源可注入，供测试使用。
    - `detailFor` 按 `path|file|file_path → command|cmd → pattern|query → url → description → name` 取参数，清洗控制字符后截到 40 列。
    - 自述：从流式 assistant 文本中取行首 `⏵`（最多 80 显示列），静默 5s 过期。
    - 一次性插话（打断接梗、`compaction` 完成）显示 6s。
    - 卡住原因"审批"优先于文案池。
    - 连击：同 Run 内工具间隔 ≤10s 且 ≥2 次时显示 `工具xN`。
    - git 段：`· git <branch>`。
    - 不做 snapshot / restore、兼容层、minimal 模式、配置项。
- `conversation.ts`：把事件同时喂给 activity reducer；跟踪 token 段。`↑` 为最近一个 Turn 的 assistant `usage.input`；`↓` 在流式时为本 Turn 已收到的文本 + thinking 字符数 / 4，`message_end` 时校正为真实 `usage.output`，跨 Turn 累计。
- `index.tsx`：
  - 输入框上方渲染 `ActivityLine`。
  - suffix 为 `· ↑ {fmtTokens} · ↓ {fmtTokens} tokens · esc 中断`，done 时省略 `esc 中断`。
  - phase 为 `idle` 时不渲染（启动后首次提交前）。
  - 权限对话框开关时派发 `approval-open` / `approval-close`。
  - 按 `render` 返回的 `nextWakeAt` 安排下一次 reduce 刷新，与 60ms 的扫光动画分开。
- `createChat`：
  - 向 `createSession` 传 `reminderSources: [{ source: "narration", currentContent: () => NARRATE_INSTRUCTION }]`，指令文本照搬 `lang.ts` 的 `narrate-instruction`（zh）。基础 System Prompt 不改；内容不变时 `collectReminders` 不会重复注入。
  - 启动时读一次 `git branch --show-current`，失败则不显示 git 段。

### 仓库

- 不改 CONTEXT.md，不写 ADR。
- 无输入来源的功能各开一张 `needs-triage` 工单（见 Further Notes）。

## Testing Decisions

- 状态机（`apps/neant-tui/tests/screens/chat/activity.test.ts`）：假时钟 + 注入随机源，喂 `SessionEvent` 序列，断言 `render` 的 phase 与 line：
  - 阶段迁移：waiting → thinking（首个 delta）→ tool → thinking → done。
  - 文案确定性：同 seed 同 slot 结果相同；4s 边界换条；30s / 60s / 300s 分档。
  - 工具行：`detailFor` 取参与截断，连击 `工具x3`，刚完成保留 2.5s。
  - 自述：提取 `⏵`，5s 后过期。
  - 插话：打断接梗、compaction 插话 6s 后消失。
  - 审批卡住原因优先于文案池。
  - done 汇总文本，跨 Turn 累计。
  - `nextWakeAt` 取整秒、换条边界、过期三者中最早的一个。
- `sweep`（`packages/tui/tests/design-system/`）：窗口外为 base；窗口位置随 time 前进；相邻同色合并；CJK 双宽字符按 2 列计。
- `useAnimationFrame`：两个订阅者只开一个定时器；全部卸载后停表；`null` 不订阅。`Spinner` 现有测试保持通过。
- `ActivityLine` 一条冒烟测试：render + headless terminal 读回首格为月相帧、文字加粗、suffix 为 subtle 色、超宽单行截断。
- 剥离：`AssistantMessage` 不渲染行首 `⏵` 行；resume 回放同样不渲染。
- e2e（`apps/neant-tui/tests/e2e/`）：用假 `streamFn` 跑一次带工具的 Run：
  - 运行中能看到状态行，结束后显示 done 行，下次提交时 done 行被替换。
  - 状态栏不再出现 `Running`。
  - 首次 Run 注入的 reminder 里含 narration 指令，第二次 Run 不重复注入。
- 视觉（扫光、帧速、颜色）手动运行 `neant` 确认。

## Out of Scope

- 英文文案、语言检测、配置项、`/activity` 命令、minimal 模式、帧预设切换、tok/s。
- snapshot / restore（Run 中途不会 resume）。
- 状态栏里的 activity 副位置、Web 端。
- Headless CLI 的状态行；CLI resume 一个 TUI Session 时 `⏵` 行不剥离（已知边界）。
- 可视区检测（`useTerminalViewport`）。

以下功能缺少 Agent Core 事件，暂不做，各开 `needs-triage` 工单：

| 工单             | 需要的事件                                    | 状态行用途                                |
| ---------------- | --------------------------------------------- | ----------------------------------------- |
| retry            | 模型请求重试开始 / 结束（含原因）             | 卡住原因 `被限流了，缓缓再试`             |
| compaction-start | compaction 开始                               | 卡住原因 `压缩上下文中…`                  |
| model-switch     | Session 中途切换模型                          | 换模型接梗 MODEL_QUIPS                    |
| subagent         | 子代理启动 / 结束                             | `子代理 N 个`                             |
| context-pressure | `session_start` 或 usage 附带 `contextWindow` | `⚠ 上下文NN%`（≥80% warning，≥95% error） |

## Further Notes

- 参考源：`~/.dsh/profiles/dsh-tui/node_modules/dsh-working-activity/`（0.5.1，BSD-3-Clause，© 2026 chimney）。状态机见 `src/status.ts`，文案见 `src/phrases.ts`，自述指令见 `src/lang.ts` 的 `narrate-instruction`。渲染见 `@deepseek-harness-tui/dsh-tui/lib/types/components/{ActivityLine,shimmer}.js`，时钟见 `ink/hooks/use-animation-frame.js`，主题见 `theme.js` 的 darkTheme。
- 术语映射：原包的 turn 对应 Neant 的 **Run**，原包的 step 对应 Neant 的 **Turn**。新代码里不使用原包的 turn 含义。
- `activity` 与 `accent` 同色，和参考项目一致，所以 thinking 与 tool 阶段的底色相同。
