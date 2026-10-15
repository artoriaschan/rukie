# 05：C40 计划预览卡与计划评审

Status: resolved

Blocked by: 03, 04

**What to build:** 让 `exit_plan_mode` 在桌面端完整可用：显示计划预览，完成评审，并在评审后展示结果。几何以 rukie.pen 的 C40（`wIUjg`）、C43 计划评审卡（`cRsh1`、`g0XIq`）和 H22 为准。

- [x] UI store：解析 `plan_review` 类型的 Interaction；回复为 `approve`、`revise { feedback }` 或 `takeover`。
- [x] C43 计划评审卡：
  - 标题为「是否按此计划执行？」，副标题是计划标题。
  - 选项固定为「批准并执行」和「继续规划」，另有一个用于填写修改意见的输入框。
  - 点「跳过」、× 或按 Esc，回复 `takeover`。
- [x] C40：把 `exit_plan_mode` 工具行渲染成计划预览卡。
  - 计划标题取第一个 Markdown 标题，没有标题时取第一行。
  - 正文高 248px，底部渐隐。
  - 提供下载 `.md`、复制两个操作；展开操作先留回调，交给 07 接入。
  - 评审结束后在卡片下方显示结果行。
  - 每次提交生成一张卡。
- [x] 批准后 C39 消失，权限模式保持不变；继续规划时 C39 保留。
- [x] 中英文文案，补齐 `tool.enter_plan_mode` 和 `tool.exit_plan_mode` 的工具行文案。
- [x] DESIGN.md：新增 C40 与计划评审规则，把审批坞相关规则扩展到计划评审。
- [x] Chromium 测试：
  - 四种操作对应的回复。
  - 标题提取、下载、复制。
  - 三种结果行。
  - 多次提交生成多张卡。
  - C39 随评审结果变化。
  - Light 和 Dark 两种主题。

## Implementation and verification

C43 plan review composes the installed beUI ApprovalCard Interaction variant, with fixed approve/revise choices and custom revise feedback; Skip, close and Escape return takeover. The mixed Interaction FIFO replaces the composer without losing the existing draft or focus restoration. Approval state follows Core plan Tool State and leaves Permission Mode unchanged. The source-based common C43 correction adds 28px outlined number circles, inline descriptions, source padding/gaps, 52px custom row and outlined pill action; default ApprovalCard presentation is unchanged.

C40 renders one preview per canonical Transcript submission outside collapsed Trace, before execution-start as well as after settlement. It uses Markdown AST titles, a 44px header and 248px body (292px total with inside stroke), download/copy and an expansion callback for ticket07. Three result lines use validated details, independently of output text and isError. The shared plan selector keeps occurrence-based identities across partial, commit, late partial and snapshot while repeated provider call IDs create separate submissions; no plan document state is persisted.

Focused evidence: 23 tests in four browser files passed, plus five UI store cases. Subsequent preview-only four-case acceptance passed after inside-stroke/download-failure coverage, and the final source-gap/multiple-description correction passed three affected C43 geometry/multiple cases. Scoped UI types, task-file formatting/lint and documentation checks passed. Existing permission/default ApprovalCard and unchanged keyboard/queue evidence is reused. Exact source scopes, red/green failures and corrections, timings and logs are in the external ticket-05-verification.md handoff record. Root owns aggregate static, desktop package acceptance and final isolated agent-browser verification.

ADR coverage follows spec: Frontend review choices preserve ADR-0015, wire kinds/settlement preserve ADR-0031, and reconstructed plan documents preserve ADR-0016. C40/C43 styles and transient UI callback require no new ADR. Ticket07 still owns opening the expansion callback in C44; no native acceptance was performed.
