# 10: plan mode

Type: grilling
Status: resolved
Blocked by: 01, 03

## Question

只读规划、用户批准后再动手的模式怎么放进现有 Permission Mode 体系？

需定：plan mode 是第四种 Permission Mode，还是正交于 Permission Mode 的另一维度；只读限制通过地基 C 的拦截点实现时，bash 如何判定只读；进入 / 退出方式（`shift+tab` 循环、模型工具请求退出）；计划提交与批准走地基 A；批准后切到哪个 Permission Mode；`CONTEXT.md` 是否需要新术语。

## Answer

2026-10-04 grilling 结论（术语 **Plan Mode** 已入 `CONTEXT.md`）。参考：deepseek-harness `packages/plan/plan-mode`、dsh-TUI `docs/interaction.md`「计划评审」、claude-code `EnterPlanModeTool` / `ExitPlanModeV2Tool`。

1. **与 Permission Mode 正交**：Plan Mode 是一个 session 级开关，不是第四种 Permission Mode。`Shift+Tab` 继续只循环 Permission Mode。退出 Plan Mode 时 Permission Mode 不变。
2. **只引导，不限制**（照 harness）：Plan Mode 不改变任何工具的权限，bash、edit、MCP 照常走 Permission Rule → Permission Mode。想要真正只读，用户自己切到 `ask` 模式。**推翻「地基 C」第 1 条中"plan mode 的只读限制作为规则阶段里的一组内置 deny"**，权限判定链不因 Plan Mode 改动。
3. **持久化**：Tool State `plan`，值为 `{ active }`，resume 后保留。用户中途退出后再回来，仍处于规划阶段。
4. **给模型的提示**：用 System Reminder（source `plan-mode`），不改 System Prompt，避免 prompt cache 失效。激活期间按 reminder 机制注入：先探索，再用 `exit_plan_mode` 提交 markdown 计划。退出时注入一条"已退出 plan mode，可以执行"。
5. **工具**：
   - `enter_plan_mode`：无参数，走 ask 审批，复用现有审批框。
   - `exit_plan_mode { plan: string }`：plan 为 markdown 全文，经评审交互提交。
   - 两个工具都常驻工具集，进出 Plan Mode 不改变工具列表（照 harness）。状态不符时调用会报错：Plan Mode 外调用 `exit_plan_mode`、已在 Plan Mode 时调用 `enter_plan_mode`。
   - 计划只存在于工具参数和 transcript 里，不写磁盘文件，用户不能在评审前编辑。不做 `allowedPrompts`。
6. **评审交互**：新增 frontend 回调 `onPlanReview`（地基 A 的形状：每种交互一个回调）。选项有两个：
   - `批准`：退出 Plan Mode，工具结果为"approved"。
   - `继续规划`：可附反馈，以失败的工具结果返回，模型停在 Plan Mode 继续规划。

   `Esc` 表示用户要接手：工具结果为"用户要接手，等待下一条消息"，模型停在 Plan Mode。run 中止时评审以取消结束。

7. **Headless CLI**：不提供 `--plan`，也不提供 `onPlanReview`。按地基 A 第 2 条，`enter_plan_mode` / `exit_plan_mode` 不注册。**这一点修订地基 A 第 2 条中"plan 批准 → 拒绝并保持只读"的安全默认值**：plan 评审只有模型工具一个入口，所以按"先去工具"处理。
8. **入口**：
   - 用户：TUI 的 `/plan [message]` 打开 Plan Mode，带 message 时同时作为下一条 prompt；`/plan off` 关闭。这两个属于 Slash Command，由 frontend 解析后调用 `session.setPlanMode(on)`。
   - 模型：`enter_plan_mode`。
9. **子代理**：子代理共享父 session 的 Plan Mode 状态（按引用共享，同地基 C 第 7 条），会收到 plan reminder。子代理工具集里没有 `enter_plan_mode` / `exit_plan_mode`，计划只能由父代理提交。
10. **TUI**（照 dsh-TUI）：
    - 评审面板复用审批框槽位，计划用 markdown 渲染，可滚动。按键：`1`/`2` 选择，打字进入反馈输入行，`Enter` 提交，`Esc` 接手，鼠标可点选。
    - Plan Mode 下输入框边框换成 plan 色，StatusLine 显示 `plan` chip。
    - `exit_plan_mode` 的工具卡在获批后显示折叠的计划。

## Comments

2026-10-06：[TUI 工具卡](20-tui-tool-card.md) 修订 transcript 呈现——`enter_plan_mode` / `exit_plan_mode` 不出工具行；原嵌在 `ToolCall` 内的 `▸/▾` plan Markdown 提为独立的 plan review 行。
