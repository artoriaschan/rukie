Status: ready-for-agent

# Spec: 输入框底部状态栏（Status Line）

## Problem Statement

`neant` 输入框下方只有一行 `model · input N · output N`，而且这两个数每次提交都会清零。我看不到上下文已经用了多少、离 Compaction 还有多远、模型输出有多快、缓存命中了多少，也看不到 git 分支和所在目录（分支其实已经读到了，但没显示）。上下文快满时，活动行上也没有任何提示。工作中的 `esc 中断` 挂在活动行后缀里，"回到底部"的提示单独占一行，footer 高度会跟着跳。我想要 dsh-TUI 那样的三行状态栏：上下文分段条、字段行、提示行，鼠标悬停字段时能看到明细。

## Solution

按 dsh-TUI `StatusLine` 的紧凑模式移植，固定三行，常驻显示：

```
████▓▓▓▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░13k/64k 19.5%
deepseek-chat · ▕███····▏ 42 tps · high · 缓存 62.0% · 12k→3k · main · Neant   ctx 19% (13k/64k)
esc 中断
```

- 第 1 行是上下文分段条：system、prompt、assistant、thinking、tools 五段按估算比例着色，剩余部分是空闲段，读数显示在空闲段右端。
- 第 2 行是字段行，各字段之间用 `·` 分隔，ctx 字段固定在最右边。
- 第 3 行是提示行，按优先级显示以下内容之一：hover 明细、滚动提示、`esc 中断`。
- 鼠标悬停字段时，第 3 行显示该字段的明细；悬停 ctx 时，ctx 字段原位变成小仪表。

Agent Core 新增 `context_usage` 事件，把 Context Usage 交给所有 frontend。活动行在上下文用到 80% 以上时加前缀 `⚠ 上下文 N%`。

## User Stories

1. 作为用户，我想在输入框下方看到一条横跨终端的上下文分段条，一眼看出上下文已经用了多少。
2. 作为用户，我想让分段条按 system / prompt / assistant / thinking / tools 分色，看出上下文主要被什么占用。
3. 作为用户，我想在分段条空闲段的右端看到 `13k/64k 19.5%`，空间不够时只显示 `19.5%`。
4. 作为用户，我想让读数在用量 ≥80% 时变为 warning 色、≥95% 时变为 error 色，提前知道 Compaction 快来了。
5. 作为用户，我想在终端过窄（内容宽度 <14 列）时隐藏分段条，以免画出一条看不清的条。
6. 作为用户，我想在启动或 resume 后立即看到分段条（此时用估算值），不必等第一个 step 结束。
7. 作为用户，我想在 Compaction 完成后看到分段条缩回去，prompt 段变成摘要的大小。
8. 作为用户，我想在字段行看到模型名。
9. 作为用户，我想在工作中看到 tps 仪表加着色数值（≥50 绿、≥20 黄、<20 红），知道模型输出有多快。
10. 作为用户，我想在空闲时看到最近 12 次 tps 的 sparkline，看出速度的变化趋势。
11. 作为用户，我想看到 thinking 级别（如 `high`）。
12. 作为用户，我想看到缓存命中率 `缓存 62.0%`。
13. 作为用户，我想看到整个 Session 累计的 `in→out` token，不会因为每次提交而清零。
14. 作为用户，我想看到 git 分支名，不在 git 仓库时不显示这个字段。
15. 作为用户，我想看到 cwd 的 basename。
16. 作为用户，我想让 ctx 字段 `ctx 19% (13k/64k)` 固定在字段行右边，终端变窄时其他字段先截断，ctx 不截断。
17. 作为用户，我想在窄终端下让每个字段各自截断，而不是换行把界面挤乱。
18. 作为用户，我想在鼠标悬停 ctx 时让它原位变成同宽的小仪表，第三行列出各分段的 token 数。
19. 作为用户，我想在悬停分段条时看到每段的色块、名称和数量。
20. 作为用户，我想在悬停缓存字段时看到 read / write / input 的具体数。
21. 作为用户，我想在悬停 tps 时看到当前值、近 60 秒平均值、均值和 p95。
22. 作为用户，我想在悬停 tokens 时看到 in / out / total 的完整数字。
23. 作为用户，我想在悬停模型时看到 provider 和上下文窗口大小。
24. 作为用户，我想在悬停 git 或 cwd 时看到完整的分支名或路径，以免被截断后看不全。
25. 作为用户，我想让鼠标移开字段后，第三行恢复原来的提示。
26. 作为用户，我想在工作中让第三行显示 `esc 中断`，空闲时为空。
27. 作为用户，我想让"有新输出 · Ctrl+End 回到底部"显示在第三行，不再在输入框上方额外占一行。
28. 作为用户，我想让 footer 高度保持不变，悬停或出现提示时正文不会被顶上去。
29. 作为用户，我想在上下文用到 80% 以上时看到活动行出现 `⚠ 上下文 85%` 前缀（≥95% 为 error 色），因为工作中我的视线在活动行上。
30. 作为用户，我想让活动行后缀不再重复显示 `esc 中断`。
31. 作为 headless CLI 脚本作者，我想在 stream-json 里收到 `context_usage` 事件，自己展示上下文用量。
32. 作为 `@neant/tui` 使用者，我想要 `Box` 的 `onMouseEnter` / `onMouseLeave`，不必自己做 hit-test。
33. 作为 `@neant/tui` 使用者，我想让 `ThemedText` 的 `backgroundColor` 接受主题 token。
34. 作为维护者，我想让分段条颜色来自主题，不在组件里写死 hex。

## Implementation Decisions

### ① 渲染器（`@neant/tui`）

- 全屏模式在原有 1000 + 1006 的基础上，再开启 1002 + 1003（any-motion）鼠标追踪，退出时关闭。
- 输入解析器把不带按键的 motion（SGR 按键码含 `0x20` 且基础键为 3）解析为 `{ type: "move", x, y }`。wheel 的行为保持不变。
- `Box` 新增 `onMouseEnter` / `onMouseLeave` 两个 prop。
  - 渲染器每帧记录节点的屏幕矩形，收到 move 时按坐标做 hit-test。
  - 命中的是节点及其祖先链上所有带 hover 回调的节点组成的集合。与上一次的集合做差，先派发 leave，再派发 enter。
  - 鼠标仍在同一格时直接跳过；resize 时清空 hover 集合。
  - 不使用定时器节流。
- `ThemedText` 的 `backgroundColor` 增加主题 token 映射，传入原始颜色值时仍原样透传。
- 主题新增 `barSystem`、`barPrompt`、`barAssistant`、`barThinking`、`barTools`、`barFree`、`barFreeText`，dark 主题取 dsh 的值：`#22305F` / `#2B3D78` / `#344A92` / `#4D6BFE` / `#5A7CFF` / `#2E3440` / `#8D95A6`。速度色和压力色复用 `success` / `warning` / `error`。

### Agent Core（`@neant/agent` + `@neant/shared`）

- 新增 SessionEvent `context_usage`，形状如下：

  ```ts
  type ContextUsageEvent = {
    type: "context_usage";
    used: number; // provider 报告的 input + cacheRead + cacheWrite；没有真实 usage 时为分段估算之和
    window: number; // 模型 contextWindow
    segments: {
      system: number;
      prompt: number;
      assistant: number;
      thinking: number;
      tools: number;
    };
  };
  ```

- 发出时机：Run 开始（跟在 `session_start` 之后）、每个 step 的 assistant `message_end` 之后、`compaction_end` 之后。`session_start` 本身不改。
- 分段估算统一用 `ceil(chars / 4)`，口径与 dsh 一致：
  - system：System Prompt；
  - prompt：user 消息文本，System Reminder 也计入此段；
  - assistant：assistant 文本块，加上 tool call 的 name 与 arguments；
  - thinking：thinking 块；
  - tools：tool result 及错误文本。
- 每次发出时都按当前 transcript（Compaction 之后则为摘要加其后的消息）重新计算分段，不做增量累加。这样 Compaction 和 resume 都不需要单独处理"重置"。
- 真实 usage 取最后一个 assistant step 的 usage；Compaction 之后真实 usage 作废，改用估算值，直到下一个 step 结束。
- headless CLI 的 stream-json 原样透传这个事件。目前没有外部消费者，属于新增事件，不算破坏性变更。

### ③ `StatusLine` 组件（只接收 props）

- props 包含 Context Usage、模型名、provider、thinking 级别、tps 当前值和样本、Session 累计 usage（input / output / cacheRead / cacheWrite）、git 分支、cwd、是否在工作、滚动提示文案和终端列数。组件内部只有 hover 状态。
- 根节点为 `paddingX={1}`、宽度等于终端列数，内容宽度为 `columns - 2`。三行高度固定，第三行即使为空也保留。
- **分段条**：
  - 每个非零的已用段至少占 1 列，其余列（含空闲段）按最大余数法分配。
  - 读数右对齐放在空闲段内，优先显示 `13k/64k 19.5%`，放不下时显示 `19.5%`，仍放不下则不显示。
  - 读数 ≥80% 用 warning 色，≥95% 用 error 色。
  - 内容宽度 <14 时不显示分段条，此时该行留空，高度不变。
- **字段行（紧凑模式）**：
  - 左侧依次为 model、tps、effort、`缓存 x%`、`in→out`、git、cwd 的 basename，用 subtle 色的 `·` 分隔。每个字段各自 `flexShrink` 并截断。
  - ctx 字段 `ctx {pct}% ({used}/{window})` 放在不收缩的右侧容器里。
  - 百分比 <10 时保留 1 位小数，否则取整，上限 999。
  - 计数格式：<10k 保留 1 位小数，以上用 `k` 和小写 `m`。
  - 缓存命中率 = cacheRead / (input + cacheRead + cacheWrite)，分母为 0 时不显示该字段。
  - effort 没有 thinking 级别时不显示；git 没有分支时不显示。
- **tps 字段**：
  - 工作中显示 11 格仪表，用 `▕`、`█`、1/8 块和暗色 `·` 轨道拼成，满刻度取 max(峰值, 40)，后接着色的 `N tps`。
  - 空闲且有样本时显示最近 12 个样本做 min-max 归一后的 `▁▂▃▄▅▆▇█`。
  - 还没有样本时显示暗色的 `N t/s`。
- **ctx 悬停**：ctx 字段原位变成 `ctx ` + 迷你仪表 + 百分比。迷你仪表宽度等于原先计数部分的字符长度，所以字段总宽度不变。仪表填充色 <80% 为绿、≥80% 为黄、≥95% 为红。
- **第三行优先级**：hover 明细 > 滚动提示 > 工作中的 `esc 中断` > 空。
- **hover 明细文案**（标签用 subtle 色，照 dsh）：
  - bar：每段为「色块 + 名称 + 数量」。宽度不够时，分隔符依次从 `·` 降为空格、名称降为简称（sys/pr/ast/th/tl），预算为 `columns - 6`。
  - ctx：`{pct}% · {used}/{window} · free {free} · sys N · pr N · ast N · th N · tl N`
  - cache：`cache {rate} · read N · write N · input N`
  - tps：`tps N · avg60 x.x · mean x.x · p95 x.x`
  - tokens：`in N · out N · total N`，用千分位
  - model：`model {model} · provider {provider} · ctx {window}`
  - git：`git {branch}`
  - cwd：`cwd {完整路径}`
  - effort 不响应 hover。

### ④ chat 屏幕

- `conversation.ts`：
  - 新增 Session 累计 usage，跨 Run 累加，提交时不清零，resume 后从 0 开始。
  - 保存最近一次 `context_usage`。
  - 采集 tps 样本：
    - 每个 step 记录首个 text、thinking 或 toolcall delta 的时间，以及输出字符数。
    - step 进行中满 500ms 后，实时值 = (已完成 step 的 decode tokens + 当前 chars/4) / decode 秒数。
    - `message_end` 时用真实 output usage 校正。
    - Run 结束时推入一个样本，样本上限 500。
  - 原有的 Run 内 `input` / `output` / `activityInput` 语义不变，继续供活动行使用。
- `index.tsx`：
  - 用新的 `StatusLine` 替换旧的单行版本。
  - 输入框上方原来的滚动提示行删除，改为把提示文案交给 `StatusLine`。
  - 活动行后缀去掉 `· esc 中断`。
- 小屏（<40×12）时的整行提示保持不变，不渲染 `StatusLine`。

### ③ `ActivityLine`

- 新增 `warnPct` prop：≥80% 时在帧和文案之间插入 `⚠ 上下文 {N}% · `，≥95% 用 error 色，否则用 warning 色。
- 百分比 = 最近一次 `context_usage` 的 `round(used / window * 100)`。

## Testing Decisions

测试只断言外部行为：事件流内容、终端屏幕字符和颜色、回调的调用顺序，不检查内部状态或私有函数。列分配、sparkline、格式化这些逻辑不单独写纯函数单测，统一通过组件渲染输出来断言。共四个接缝，都是已有的：

1. **Agent Core 事件流**：沿用 `packages/agent/tests/e2e/` 里假 `streamFn` 的写法，参照 compaction、run 的 e2e。断言以下几点：
   - Run 开始、每个 step 结束、`compaction_end` 后都会发出 `context_usage`；
   - `used` 取真实 usage，没有 usage 时（首次 Run、resume、Compaction 之后）取估算值；
   - 五个分段的归类正确，System Reminder 计入 prompt，tool call 计入 assistant；
   - Compaction 后 prompt 段约等于摘要大小，其他会话内容段归零；
   - `window` 等于模型的 `contextWindow`。
   - headless CLI 的 stream-json 输出里包含该事件。
2. **`@neant/tui` 渲染器**：沿用 `tests/renderer/` 中"render + 假 stdin"的写法。断言以下几点：
   - 全屏开启和退出时会写出 1002/1003 模式的开关序列；
   - 写入 SGR motion 后，嵌套 Box 的 enter/leave 按"先 leave 后 enter"的顺序派发；
   - 鼠标停在同一格时不重复派发；
   - 移出所有节点时会派发 leave；
   - wheel 的行为不变。
   - `ThemedText` 的 `backgroundColor` 使用主题 token 时，输出对应的 SGR 48 颜色，可参照现有 background-color 测试。
3. **`apps/neant-tui` headless xterm 终端**：沿用 `tests/helpers/terminal.ts` 和 `tests/e2e/`。断言以下几点：
   - 80、60、40 列下 footer 三行的屏幕内容；
   - 工作中第三行显示 `esc 中断`，结束后清空；
   - 滚动离开底部时第三行出现滚动提示，并且输入框上方不再多出一行；
   - 写入 motion 序列悬停 ctx 和 model 后，第三行显示对应明细，ctx 原位变为迷你仪表，移开后恢复；
   - footer 高度在悬停前后不变；
   - 假 usage 推到 ≥80% 时活动行出现 `⚠ 上下文` 前缀；
   - Session 累计 token 跨两次提交仍在累加。
4. **组件冒烟测试**：沿用 `tests/components/`，参照 activity-line 和 logo 的测试，覆盖终端 e2e 难以构造的情况：
   - 分段条在不同比例、宽度下的列分配，包括非零段至少占 1 列；
   - 读数在三档宽度下的降级；
   - 宽度 <14 时隐藏；
   - 80% 和 95% 时的颜色；
   - tps 的仪表、sparkline、无样本三种形态，以及三档速度色；
   - 字段缺失（无分支、无缓存、无 thinking 级别）时不显示对应字段，也不留下多余的分隔符。

## Out of Scope

- 字段开关和偏好配置（字段写死）、full 模式、minimal UI。
- cost、goal、IDE selection、MiniWake/trajectory、jobs、session title/id、mode 字段，以及 shift+tab 切换 mode。
- `?` 快捷键面板，以及空闲时的 `? 快捷键` 提示。
- light 主题。
- resume 时回放历史 usage：Session 累计 token 从 0 开始。
- 渲染器的 click 和拖选事件，以及悬停提示框（tooltip）。

## Further Notes

- 本 spec 吸收了 `.scratch/working-activity/issues/09-context-pressure.md`，09 标记为 wontfix。
- 参考实现见 dsh-TUI 的 `src/screens/StatusLine.tsx`、`src/screens/StatusMetrics.ts`、`src/ink/hit-test.ts` 和 `src/dsh-adapter/channel/projection.ts`。
- 术语见 `CONTEXT.md` 的 **Context Usage**。
