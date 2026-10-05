Status: resolved

# Spec: Checkpoint 与 Rewind

来源：[撤销改动 / checkpoint](../agent-core-roadmap/issues/13-checkpoint-and-rewind.md)；基于 [地基 B：工具状态进 transcript](../agent-core-roadmap/issues/02-tool-state-in-transcript.md)、[地基 C：工具调用前后拦截点](../agent-core-roadmap/issues/03-tool-call-interception.md)、[子代理](../agent-core-roadmap/issues/06-subagent.md)；参考 Claude Code checkpointing（file history）、调研 [权限规则 / hooks / checkpoint](../agent-core-roadmap/issues/05-research-rules-hooks-checkpoint-prior-art.md)。术语见 `CONTEXT.md` 的 Checkpoint、Rewind。

## Problem Statement

agent 改坏了文件、或者我想换个说法重问时，只能手动 `git checkout` 或重开 session。对话无法退回到某条 prompt 之前，agent 写过的文件也无法一键还原；子代理改的文件更难追踪。

## Solution

每条 user prompt 开始时自动建一个 Checkpoint，记下本次 prompt 中 agent（含子代理）用文件工具首次写入每个文件前的内容。session 空闲时，用户在 TUI 空输入框双击 Esc 打开 Rewind 列表，选一条 prompt，再选"回代码 + 对话 / 只回对话 / 只回代码"。回对话后那条 prompt 文本填回输入框，便于修改重发。bash 造成的改动不会还原，界面明确提示。

## User Stories

1. 作为 TUI 用户，我希望每条 prompt 前自动有 Checkpoint，这样不用手动备份就能回退。
2. 作为 TUI 用户，我希望在空输入框双击 Esc 打开 Rewind 面板，首次 Esc 有 "Press Esc again to rewind" 提示，这样快速找到入口又不误触。
3. 作为 TUI 用户，我希望 run 进行中双击 Esc 仍是中止，这样已有习惯不被打破。
4. 作为 TUI 用户，我希望 Rewind 面板按新到旧列出本 session 的 user prompt 单行预览，这样最近的一条最容易选。
5. 作为 TUI 用户，我希望列表每行显示该 prompt 改动的文件数，这样判断哪条值得回代码。
6. 作为 TUI 用户，我希望选中后可选"回代码 + 对话"，这样完整回到那条 prompt 之前。
7. 作为 TUI 用户，我希望可选"只回对话"，这样保留文件改动、只换说法重问。
8. 作为 TUI 用户，我希望可选"只回代码"，这样撤销改动但保留对话上下文。
9. 作为 TUI 用户，我希望能取消，这样误开列表无副作用。
10. 作为 TUI 用户，我希望确认前看到将被还原、将被删除的文件清单，这样知道会发生什么。
11. 作为 TUI 用户，我希望确认界面提示"bash 造成的改动不会还原"，这样不对回滚范围产生误解。
12. 作为 TUI 用户，我希望回对话后被回退的 prompt 填回输入框，这样改两句就能重发。
13. 作为 TUI 用户，我希望回退后消息列表立即显示回退后的对话，这样状态一目了然。
14. 作为 TUI 用户，我希望回代码时把文件直接还原为 Checkpoint 内容，即使之后我手动改过，这样行为可预期。
15. 作为 TUI 用户，我希望 Checkpoint 之前不存在、后来由 agent 新建的文件在回代码时被删除，这样目录真正回到原状。
16. 作为 TUI 用户，我希望回到第 N 条 prompt 时，第 N 条及之后所有 prompt 的文件改动都被还原，这样代码与对话位置一致。
17. 作为 TUI 用户，我希望子代理改的文件也算进发起它的那条 prompt 的 Checkpoint，这样回滚覆盖子代理工作。
18. 作为 TUI 用户，我希望被拒绝的写入不产生快照，这样列表里的改动数真实。
19. 作为 TUI 用户，我希望 Goal 续跑、Stop hook 续跑产生的写入归同一条 prompt，这样一次请求一个 Checkpoint。
20. 作为 TUI 用户，我希望同一 prompt 内多次写同一文件只记首次写前的内容，这样回滚到的是 prompt 前的版本。
21. 作为 TUI 用户，我希望 session 有 run 或 running 子代理时无法 Rewind，这样不会与进行中的写入冲突。
22. 作为 TUI 用户，我希望 resume 旧 session 后仍能 Rewind 到之前的 prompt，这样关掉 TUI 不丢失回退能力。
23. 作为 TUI 用户，我希望回退到 compaction 之前的 prompt 也可行，这样长对话也能回到早期。
24. 作为 TUI 用户，我希望回对话后 todo、Plan Mode、Goal 等 Tool State 跟着回到那个时点，这样状态与对话一致。
25. 作为 TUI 用户，我希望回对话后原分支仍保留在 transcript 中，这样数据不因误操作丢失。
26. 作为 TUI 用户，我希望回退后继续发 prompt 时从新位置接着建 Checkpoint，这样可以反复回退。
27. 作为 TUI 用户，我希望备份不进入项目目录、不碰 `.git`，这样仓库干净。
28. 作为 TUI 用户，我希望超过 30 天的备份在启动时自动清理，这样磁盘不会无限增长。
29. 作为 TUI 用户，我希望备份文件缺失时（如已被清理）回代码给出明确错误、不半途改动，这样不会留下半还原状态。
30. 作为 frontend 开发者，我希望 Session 提供 `checkpoints()` 列出锚点、预览与改动文件，这样能渲染列表。
31. 作为 frontend 开发者，我希望 Session 提供 `rewind(entryId, { code, conversation })`，这样一个调用完成回退。
32. 作为 frontend 开发者，我希望 `rewind` 在 session 非空闲时拒绝并报错，这样 frontend 不必自己维护并发判断的唯一真相。
33. 作为 frontend 开发者，我希望 `rewind` 返回被回退的 prompt 文本与还原 / 删除的文件，这样能填回输入框并显示结果。
34. 作为 frontend 开发者，我希望 rewind 后 `messages` 与 `toolState()` 立即反映新分支，并发出相应状态事件，这样 UI 不用重建 session。
35. 作为 Headless CLI 用户，我不需要 Rewind；需要时可以 resume 后自行处理，这样 CLI 面保持简单。
36. 作为 Neant 维护者，我希望 Checkpoint 引用作为 Tool State `checkpoint` 记入 transcript，这样复用已有持久化与 last-wins 恢复。
37. 作为 Neant 维护者，我希望快照挂在地基 C 的放行后阶段，这样不另开拦截路径。
38. 作为 Neant 维护者，我希望 `write` 与 `edit` 都经同一快照路径，这样新增文件工具只需接入一处。
39. 作为 TUI 用户，我希望 Rewind 面板的外观和按键与 dsh-TUI 一致（停靠输入框上方、`❯` 选中、↑/↓ 循环、Enter 确认、Esc 返回），这样两个工具间切换无需重新学习。
40. 作为 TUI 用户，我希望没有可回退的 prompt 时双击 Esc 只给提示，这样不会弹出空面板。
41. 作为 TUI 用户，我希望回退完成后有 notice 告诉我结果与下一步，这样知道已生效。

## Implementation Decisions

- **新模块 `checkpoint/`（Agent Core）**：按 `CONTEXT.md` 一概念一目录，经 `index.ts` 暴露。负责：
  - 备份文件；
  - 维护 Tool State `checkpoint`；
  - 计算 rewind 的还原计划；
  - 启动时清理过期备份。
- **快照时机**：挂在地基 C 的放行后阶段（判定 allow 之后、执行之前，只读、不可改判）。工具名为 `write` 或 `edit` 时，取改写后参数中的路径，经与权限相同的 realpath 规范化。若当前 Checkpoint 尚未记录该路径，则先备份。被拒调用不经过此阶段。bash、MCP 工具不快照。
- **Checkpoint 锚点**：每次 user prompt run 开始时，以这条 user 消息的 entry id 作锚点开新 Checkpoint。hook autorun、Goal 续跑、Stop 续跑、子代理完成通知 steer 进来的 user 消息都不开新 Checkpoint，它们的写入归当前 Checkpoint。
- **备份存储**：
  - 文件内容按 sha256 存到 `~/.neant/file-history/<sessionId>/<hash>`，原样字节，同内容去重。
  - 写前文件不存在的记为"原本不存在"。
  - 不经 `.git`，不写项目目录。
- **Tool State `checkpoint`**：版本 1，完整快照、last-wins，沿用地基 B 的 `tool-state/checkpoint` custom entry。不渲染 reminder，模型看不到。形状大致如下：

  ```ts
  {
    checkpoints: Array<{
      promptEntryId: string;
      files: Array<{ path: string; backup: string | null }>;
    }>;
  }
  ```

  `backup` 为 null 表示原本不存在。每次新增文件记录时追加一份快照。

- **子代理**：子 session 不建自己的 Checkpoint。父 session 把 checkpoint 记录器随判定配置一起按引用传给子 session，子代理的写入直接记进父 session 当前 Checkpoint 和父 transcript 的 Tool State。`subagent_fork` 同理。
- **Session API**：
  - `checkpoints()`：返回每个 Checkpoint 的 `promptEntryId`、prompt 预览文本与改动文件列表，按时间顺序。
  - `rewind(promptEntryId, { code, conversation })`：至少一项为 true。返回被回退的 prompt 文本以及已还原、已删除的文件。session 非空闲（running，或有 running 子代理）时抛错。
- **回代码**：
  - 取从目标 Checkpoint 到末尾的所有 Checkpoint，对每个路径取最早的一条记录：有备份就写回，`null` 就删除文件（不存在时忽略）。
  - 先校验所有备份都存在，缺失就整体报错、不改任何文件。
  - 不检测冲突，直接覆盖。
  - 只回代码时，Tool State `checkpoint` 不变。
- **回对话**：
  - 把 `branchTip("main")` 设到目标 user 消息 entry 的 parent，原分支保留。
  - 随后在内存中按新分支重建 messages、Tool State（todo、plan、goal、checkpoint 等）与 compaction 状态，发出对应状态事件，等价于对该点做一次 resume，但不新建 Session。
  - 目标在 compaction 之前也可回，新分支上不含之后的摘要。
  - 两者都回时，先回代码再回对话：代码失败则对话不动。
- **清理**：`createSession` 启动时删除 `~/.neant/file-history/` 下 mtime 超过 30 天的 session 目录。备份目录尚不存在（`ENOENT`）时静默跳过，不为清理创建目录；其他读取或删除失败只发 warning。
- **TUI（照 dsh-TUI `RewindPicker`，界面、样式、交互均参照之）**：
  - **触发**：仅 session 空闲、输入框为空时生效。第一次 Esc 开 3000ms 窗口，并显示 notice "Press Esc again to rewind"（i18n）；窗口内第二次 Esc 打开面板。没有可回退的 prompt 时，只提示 "Nothing to rewind yet"。输入框有内容时 Esc 照旧清空；run 中 Esc 照旧中止。有挂起交互（审批、提问、plan 评审）时不触发。
  - **布局**：新增 app 组件 `rewind-picker`（③层，props only），停靠在输入框上方的面板槽位，不全屏；与 dsh-TUI 的实际 OverlayAbove 挂载方向一致，Neant 用 flow 布局保持 Todo / child 面板共存。外框用 design-system 的 `Divider` 顶线，取 permission 色。标题 "Rewind" 用 remember 色加粗；副标题 dim，文案 "Pick a message to rewind to"。
  - **列表**：
    - 本 session 的 user prompt 按新到旧排列，只含真实用户输入，不含 hook / Goal / 子代理通知 steer 进来的消息。
    - 每行是单行预览：空白折叠，截断到 80 字符加 "…"。
    - 首行描述为 "last message"；描述用 inactive 色，有文件改动的行另附 "N files changed"（与 dsh-TUI 的差异：dsh 无代码回滚）。
    - 选中行前缀 `❯`，用 design-system `ListItem` 的 picker 样式：suggestion 色、不额外加粗，原生终端光标停在左侧 `❯`；可点击行悬停背景与 dsh 一致。
    - 整个回退区域（含顶部 gap、Divider、标题、列表、提示）最多 14 行，并受输入框、statusline 与 Todo / child 预览之后的实际空间约束。短列表按内容自然撑高，不填满上限；充足空间时单 prompt 9 行、两 prompt 10 行，超出后窗口化。列表按实际行成本向两侧平衡扩展，焦点大致居中。边缘非焦点行的左侧 gutter 显示 ↑/↓；焦点 `❯` 优先，不另加右侧箭头。模式内移动焦点时输入框与页脚位置稳定；不同列表 / 确认页按各自自然尺寸。
    - 底部 dim italic 提示 "Enter to select · Esc to exit"。
  - **按键**：↑/↓ 移动，首尾循环；Enter 进入确认；Esc 关闭面板；消息列表鼠标点击只移动焦点，Enter 才进入确认；确认页点击直接执行当前点击的模式（与 Enter 同路径）。不做 j/k 和搜索。
  - **确认步**：
    - 原地替换列表内容。存在文件改动时，标题 "Rewind to this message?" 与 dim prompt 预览在同一行，标题下留一行 gap 再展示模式。无文件改动时用 dsh 的 plain 确认形状：标题、gap、无焦点指针的 prompt 行及 inactive 描述 "conversation restarts here"，点击该行或 Enter 直接回对话。
    - 选项照 dsh 插件模式列表，↑/↓ + Enter 选择："Restore code and conversation" / "Restore conversation" / "Restore code"。该 Checkpoint 起无文件改动时仅提供 plain 回对话确认。
    - 涉及回代码的选项获得焦点时，下方列出将还原、将删除的文件（超出可见行数时折叠为 "+N more"），并固定 dim 提示 "Changes made by bash are not restored"。
    - 提示 "Enter to rewind · Esc to back"；Esc 回到列表。文件区按三种模式的最大实际内容预留，切换为只回对话时保留区域高度，避免抖动。
  - **完成后**：面板关闭。回对话时把返回的 prompt 文本填进输入框，并显示 notice "Rewound — edit and press Enter to resend"；只回代码时显示 "Restored N files"。失败时显示错误 notice，面板关闭、状态不变。
  - **窄屏**：40×12 起支持编辑；小屏去掉顶部 gap 与标题下 gap，列表保留标题 / 副标题，确认保留单行标题 / 预览。最低 6 行预算先于 activity / return control 分配，保留焦点、文件摘要、bash 提示、footer 与 Todo / child 各一行预览。小于 40×12 时遵循既有 resize 提示，隐藏面板并暂停 Enter / 方向键，恢复到支持尺寸后保留焦点；Esc / Ctrl+C 仍可取消。
  - 所有文案进 neant-tui i18n 字典，上面引号内为 en 原文。
  - 不做 dsh 的 `/tree` 分支视图，也不做 `tui/rewind-prompt` 插件钩子。
- **`/rewind`**：等 Slash Command 框架（[自定义 Slash Command 与手动 compaction](../agent-core-roadmap/issues/16-slash-commands-and-manual-compaction.md)）落地后，接入同一个 `rewind-picker`。本 spec 不交付这个命令。
- **Headless CLI**：不暴露。

## Testing Decisions

- 只测外部行为：经 `createSession` 与 Session API 观察磁盘文件、`messages`、`toolState()`、事件与返回值。不测备份文件名、内部记录器等内部细节。
- **Agent Core e2e**（`bun:test`，新文件 `tests/e2e/checkpoint.test.ts`）：用 `fakeModel` + `tempDirs` 驱动 `write` / `edit`，覆盖以下场景：
  - 多条 prompt 的 `checkpoints()` 内容；
  - 三种 rewind 模式下磁盘与对话的结果；
  - 新建文件被删除；
  - 手动改动被覆盖；
  - 同 prompt 多次写只记首次；
  - 被拒写入不留快照；
  - 子代理写入归父 Checkpoint；
  - 非空闲时 rewind 抛错；
  - resume 后 rewind；
  - 跨 compaction 回退；
  - 回对话后 todo / Plan Mode 恢复；
  - 备份缺失时整体失败、文件不变；
  - 启动清理（预置 mtime 超过 30 天的目录）。
- **TUI**（`bun:test`，新文件 `tests/screens/chat/rewind.test.ts`）：
  - 首次 Esc 显示提示、3000ms 内第二次打开面板、超时后重新计窗；
  - 无 prompt 时只提示不开面板；
  - 列表新到旧、预览截断、首行 "last message"、文件数描述；
  - ↑/↓ 循环、Esc 从确认返回列表、再 Esc 关闭；
  - 无文件改动时只有回对话选项；
  - run 中 Esc 仍为中止；
  - 选择各选项后调用 `rewind` 的参数正确；
  - 确认清单与 bash 提示可见；
  - 回对话后 prompt 填回输入框；
  - 有挂起交互时不打开。
- **参考先例**：
  - `tests/e2e/plan-mode.test.ts` 中经 store 改 `branchTip` 后验证 Tool State 恢复的测试；
  - `tests/e2e/todo.test.ts` 的 Tool State 持久化测试；
  - `tests/e2e/subagents.test.ts` 的子代理驱动方式；
  - `tests/e2e/compaction.test.ts` 用小 `contextWindow` 触发压缩；
  - TUI 侧参照 `tests/screens/chat/plan-review.test.ts`、`todo-panel.test.ts`、`permissions.test.ts`；界面行为参照 dsh-TUI `RewindPicker` / `PromptInput` 的 Esc 处理（`~/Workspaces/agent/dsh-TUI`）。

## Out of Scope

- bash（及 MCP 工具）造成的文件改动的快照与还原，包括 bash 前后 mtime 扫描提示。
- 整树影子 git 快照。
- 回滚时的逐文件冲突检测与合并。
- 子 session 自己的 Rewind 入口。
- Headless CLI 的 Rewind。
- `/rewind` Slash Command 本身，由 Slash Command 工单接入。
- 在 TUI 中浏览或切回被回退掉的旧分支。
- 可配置的备份保留期。
- dsh-TUI 的 `/tree` 分支视图（fork / adopt branch）与 rewind 插件钩子。

## Further Notes

- 设计与 Claude Code checkpointing 对齐：每 prompt 一个、只跟踪文件工具、三种回退选项。
- 地基 C 的放行后阶段原本就预留给 checkpoint；若当时未实现，本 spec 实现时补上，并保持只读。
- 回退对话只移动分支指针，transcript 仍只追加不修改，符合 `CONTEXT.md` 的 Transcript 定义。
