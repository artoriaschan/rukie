# 05：C40 计划预览卡与计划评审

Status: ready-for-agent

Blocked by: 03, 04

**What to build:** 让 `exit_plan_mode` 在桌面端完整可用：显示计划预览，完成评审，并在评审后展示结果。几何以 rukie.pen 的 C40（`wIUjg`）、C43 计划评审卡（`cRsh1`、`g0XIq`）和 H22 为准。

- [ ] UI store：解析 `plan_review` 类型的 Interaction；回复为 `approve`、`revise { feedback }` 或 `takeover`。
- [ ] C43 计划评审卡：
  - 标题为「是否按此计划执行？」，副标题是计划标题。
  - 选项固定为「批准并执行」和「继续规划」，另有一个用于填写修改意见的输入框。
  - 点「跳过」、× 或按 Esc，回复 `takeover`。
- [ ] C40：把 `exit_plan_mode` 工具行渲染成计划预览卡。
  - 计划标题取第一个 Markdown 标题，没有标题时取第一行。
  - 正文高 248px，底部渐隐。
  - 提供下载 `.md`、复制两个操作；展开操作先留回调，交给 07 接入。
  - 评审结束后在卡片下方显示结果行。
  - 每次提交生成一张卡。
- [ ] 批准后 C39 消失，权限模式保持不变；继续规划时 C39 保留。
- [ ] 中英文文案，补齐 `tool.enter_plan_mode` 和 `tool.exit_plan_mode` 的工具行文案。
- [ ] DESIGN.md：新增 C40 与计划评审规则，把审批坞相关规则扩展到计划评审。
- [ ] Chromium 测试：
  - 四种操作对应的回复。
  - 标题提取、下载、复制。
  - 三种结果行。
  - 多次提交生成多张卡。
  - C39 随评审结果变化。
  - Light 和 Dark 两种主题。
