# 01：补齐 DESIGN.md 的空白取值与术语

Status: ready-for-agent

**What to build:** 实现 ticket 引用的所有数值都必须已经写在 DESIGN.md 里。按 [spec](../spec.md) 的「规范补齐」一节修订文档。这张 ticket 是纯文档变更，不改代码。

- [ ] 补齐圆角：
  - 28px 上下文按钮、24px 微操作、标准菜单行（32px）和 Session 紧凑菜单行（26px）。在 12px 菜单壳和 Select 面板内，这些行按第 217 行"降一级"推导为 8px。
  - Tooltip 的圆角。
  - 在 Radius 表或 Shared control targets 表中给出具名角色。
- [ ] 补齐 Dark 主题下的覆盖层阴影和 composer 阴影配方，对应第 219 行规定的共享 elevation 角色。Light 沿用规范已有的参考配方，并给出这两个角色的 token 名。
- [ ] 补齐设置页表面角色：画布、导航列、卡片、弹层和菜单在 Light/Dark 下的取值。取值优先映射到参考色板的 Canvas、Soft canvas 和 Muted surface，并说明这些角色和 `layout-*` 是相互独立的。
- [ ] 列出各表面的归属：绑定共享 token，还是绑定 `layout-*` 结构 token。至少覆盖 Plan Pane、对话摘要卡、用户消息气泡、composer、Interaction 卡和 Transcript 背景。依据第 80 行和第 101 行，Dark `background` 改为 `#212121` 不改变 `layout-content`。
- [ ] 改写过渡性表述，与 spec 的 Decisions 第 2 条一致：
  - 第 175、196、215 行中"受保护，直到显式迁移"的通用旧值说明。
  - 第 150 行中 caption 1.5 行高的保留说明。
- [ ] CONTEXT.md 新增两个呈现层术语，均注明 _Avoid_: Run, step：
  - **Trace**：一个 PromptGroup 中可见的推理与工具执行过程，不是执行模型。
  - **Activity Segment**：被助手正文切开的一段连续推理和工具条目。
- [ ] `packages/ui/README.md` 第 59 行把 PromptGroup 的展开称作"展开 Run"，改为"展开执行过程"，与 DESIGN.md 第 329 行一致。
- [ ] 运行 `bun run check:docs`，检查变更文件的格式，并运行 `git diff --check`。

## Comments
