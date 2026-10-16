# 01：补齐 DESIGN.md 的空白取值与术语

Status: resolved

**What to build:** 实现 ticket 引用的所有数值都必须已经写在 DESIGN.md 里。按 [spec](../spec.md) 的「规范补齐」一节修订文档。这张 ticket 是纯文档变更，不改代码。

- [x] 补齐圆角：
  - 28px 上下文按钮、24px 微操作、标准菜单行（32px）和 Session 紧凑菜单行（26px）。在 12px 菜单壳和 Select 面板内，这些行按第 217 行"降一级"推导为 8px。
  - Tooltip 的圆角。
  - 在 Radius 表或 Shared control targets 表中给出具名角色。
- [x] 补齐 Dark 主题下的覆盖层阴影和 composer 阴影配方，对应第 219 行规定的共享 elevation 角色。Light 沿用规范已有的参考配方，并给出这两个角色的 token 名。
- [x] 补齐设置页表面角色：画布、导航列、卡片、弹层和菜单在 Light/Dark 下的取值。取值优先映射到参考色板的 Canvas、Soft canvas 和 Muted surface，并说明这些角色和 `layout-*` 是相互独立的。
- [x] 列出各表面的归属：绑定共享 token，还是绑定 `layout-*` 结构 token。至少覆盖 Plan Pane、对话摘要卡、用户消息气泡、composer、Interaction 卡和 Transcript 背景。依据第 80 行和第 101 行，Dark `background` 改为 `#212121` 不改变 `layout-content`。
- [x] 改写过渡性表述，与 spec 的 Decisions 第 2 条一致：
  - 第 175、196、215 行中"受保护，直到显式迁移"的通用旧值说明。
  - 第 150 行中 caption 1.5 行高的保留说明。
- [x] CONTEXT.md 新增两个呈现层术语，均注明 _Avoid_: Run, step：
  - **Trace**：一个 PromptGroup 中可见的推理与工具执行过程，不是执行模型。
  - **Activity Segment**：被助手正文切开的一段连续推理和工具条目。
- [x] `packages/ui/README.md` 第 59 行把 PromptGroup 的展开称作"展开 Run"，改为"展开执行过程"，与 DESIGN.md 第 329 行一致。
- [x] 运行 `bun run check:docs`，检查变更文件的格式，并运行 `git diff --check`。

## 授权差异

本票只修订规范与术语，没有 DOM/CSS、布局断言或实际产品几何变化。以下是后续实现必须引用的文档目标；各实现票仍需记录实际旧值与新值，并验证表外几何保持不变。

| 规范区域          | 原文空白或过渡值                                     | 明确目标                                                             |
| ----------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| 圆角              | 上下文按钮、微操作、菜单行、Tooltip 未具名           | 上下文按钮/菜单行/Tooltip 8px；微操作/icon 6px                       |
| elevation         | 只有 Light 参考配方，Dark 未定义                     | `--shadow-overlay`、`--shadow-composer` 明暗配方                     |
| 设置表面          | 未给出局部角色与明暗值                               | `settings-canvas/navigation/card/popover/menu/surface/border`        |
| 内容与结构表面    | generic Dark background 与 layout-content 关系不明确 | Transcript 保持 layout-content，Plan/composer 等明确消费共享内容角色 |
| 通用控件、caption | 旧值保留到显式迁移                                   | spec 已授权迁移到具名目标；caption 默认 13px/18px                    |

## Comments

### 2026-10-16 实施与验证

- 已补齐 `DESIGN.md` 的共享圆角、明暗 elevation、settings 表面与 surface ownership 表；Light 阴影沿用原参考值，Dark 配方明确标为 Rukie 适配。所有新设置表面值来自现有参考色板，没有新增平行色板。
- 下游约束：28px contextual Button 为 8px 圆角，24px micro/icon 为 6px；标准/Session/Select 菜单行为 8px，Tooltip 为 8px。共享 token 为 `--shadow-overlay` 与 `--shadow-composer`。设置画布为 Soft canvas（`#fafafa` / `#1a1a1a`），导航与卡片为 Canvas（`#ffffff` / `#212121`），弹层与菜单为 Popover（`#ffffff` / `#2f2f2f`）。文字、字段、hover、selection、focus 与状态继续直接消费共享角色。
- `layout-content` 保持 `#ffffff` / `#000000`，Transcript/助手正文/Trace 以它为底；Plan Pane/composer 用 `background`，摘要/权限卡用 `card`，plan preview 用 `input-surface`，用户消息及 question/plan-review Interaction 用 `muted`。Plan tab strip 与框架间隙继续用 `layout-rail`。
- 通用旧几何与 caption 1.5 行高的过渡保留已改为 spec 授权的新目标；具名 Rukie feature 几何仍遵循其专项值。新增 Trace / Activity Segment 术语，README 的展开/收起对象统一称执行过程。
- 已核对相关源码 owner、术语、链接、完整 diff 和 spec ADR Coverage：本票只补齐现有设计规则与呈现词汇，不改变执行模型、状态持久化、包依赖或长期架构取舍，无需新增 ADR。
- 环境：Bun 1.4.2；`rtk proxy bun install --frozen-lockfile` 安装 888 包成功，Husky 保持启用，依赖文件无变化。
- 验证通过：`rtk proxy bun run docs:update` 与 `rtk proxy bun run check:docs` 均通过（155 Markdown 文件）；`rtk proxy bunx --no -- oxfmt --check DESIGN.md CONTEXT.md packages/ui/README.md .scratch/design-system-migration/issues/01-design-spec-gaps.md` 通过；`rtk git diff --check` 通过。补写本记录后仅复验 tracker 结构、该文件格式与 diff。
- 文档专用交付没有运行产品测试、浏览器验收或原生 Electron；本票不宣称规范目标已由产品实现或已通过渲染对比度验证。后续实现票按规范实测。
- 提交前与 integration 分支 `feat/design-system-migration`（`e22f975a`）合并核对，返回 Already up to date。该状态表示本地文档工作完成，PR 评审与 CI 由协调者继续处理。
