# 01: 预重构：交互 helper 与 TUI Interaction 队列

**What to build:** 为 ask_user_question 让路，行为零变化。Agent Core 把现有审批的取消处理（signal 已中止立即返回、与 abort 赛跑、结束后清理监听）抽为内部通用 Interaction helper，审批改用它。TUI 把审批挂起队列（状态外置于 React）泛化为 Interaction FIFO 队列，队列项带种类，暂只有审批项；"一律允许此工具"批量放行只作用于审批项。

Blocked by: None (can start immediately)

Status: resolved

参考：[spec](../spec.md) Implementation Decisions「共享 helper」「TUI 交互队列」。

- [x] Agent Core 审批经通用交互 helper，run 中止时挂起审批仍以 deny 结束
- [x] TUI 审批经泛化后的 Interaction 队列，并发审批逐个显示、"一律允许"批量放行行为不变
- [x] 现有 Agent Core 与 TUI 权限相关测试全部通过，无测试被修改语义
- [x] `tsc -b` 通过

## Answer

实现提交：`5249396`（相对基线 `e9b7197f7d237ad9ee061c07144b12043cd419ee`）。

- Agent Core 内部 `interaction/index.ts` 提供通用 `requestInteraction`：已中止直接返回、与 abort 赛跑、忽略取消后的回复、在 finally 清理监听。审批以 `deny` 作为取消值，Session 公开回调未变。
- TUI screen 持有外置的 Interaction FIFO，当前只有 `kind: "permission"`。每次按键同步读取队首；审批特有的选择、确认和拒绝只处理审批项，always-allow 的同工具批放也检查种类及 mode。
- 保留全部现有测试语义；新增公开 TUI 回归验证混合工具同时请求审批时，always-allow 放行同工具而另一工具继续等待。未实现后续 issue 的提问工具或界面。

### Validation

- 重构前基线：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/permissions.test.ts packages/agent/tests/e2e/permission-review.test.ts apps/neant-tui/tests/e2e/permissions.test.ts` — 74 pass / 0 fail。新增混合审批用例在重构前也通过，作为行为不变的特征测试；没有制造功能变化的红灯。
- 重构后 focused：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/permissions.test.ts apps/neant-tui/tests/e2e/permissions.test.ts` — 45 pass / 0 fail。
- `rtk proxy bunx tsc -b` — exit 0。
- 原用户环境 `rtk proxy env -u NO_COLOR bun run check`：format / lint / tsc / Knip 通过，测试 619 pass / 1 fail。唯一失败为 `locale.test.ts` 的英文非交互终端提示；独立重跑可复现。未修改的 `main.tsx` 在进入 chat 前读取真实用户配置，其 `locale: "zh"` 覆盖测试的 `LANG=en`。`main.tsx` 与 `locale.test.ts` 相对基线 diff 均为空；未修改真实用户配置或该测试。
- 创建临时用户目录 `/tmp/neant-issue01-home.u3WH1J`，先确认 `node:os.homedir()` 指向该目录，再运行 `rtk proxy env -u NO_COLOR HOME=/tmp/neant-issue01-home.u3WH1J bun run check` — exit 0，620 pass / 0 fail，53 files；format / lint / tsc / Knip 均通过。运行后清理新建临时目录。

### Code review

按 `/code-review` 对 `e9b7197f7d237ad9ee061c07144b12043cd419ee...5249396` 进行了两个并行子代理审查：

- Standards：0 findings。概念目录及 `index.ts` 边界、screen 状态所有权、公开测试 seam 均符合规范；泛型 helper 和 kind 是工单明确要求的预重构，无新增可操作代码异味。
- Spec：0 findings。helper 取消行为、带种类的 FIFO、审批限定的批放和测试边界均满足 issue 01；无遗漏、范围扩张或实现错误。

遗留限制：完整测试应隔离用户 HOME，避免现有非交互 Locale 用例读取本机配置；本次没有扩展工单范围修复该测试。
