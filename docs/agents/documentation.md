# 文档维护流程

维护文档时使用仓库 [rukie-doc](../../.agents/skills/rukie-doc/SKILL.md)。文档归属与表达由[文档规范](../AGENTS.md)定义，长期决定格式由[ADR 规则](../adr/README.md)定义，实施票遵循[Issue tracker](issue-tracker.md)。

## 调用

支持仓库 skills 的代理可显式调用 `$rukie-doc`，Rukie 的 skill slash 调用使用 `/rukie-doc`。已运行的代理若尚未发现新增 skill，可直接读取 `.agents/skills/rukie-doc/SKILL.md` 执行同一流程；自动选择取决于宿主的 skill 发现机制。

```text
$rukie-doc 更新 docs/mcp.md，核对当前配置和授权行为，并修复相关引用。
$rukie-doc 审阅 packages/agent/README.md，只输出遗漏与过时事实。
$rukie-doc 记录已确认的架构决定，检查已有 ADR 是否被替代。
```

## 执行顺序

1. **确定范围。** 读取用户请求、根与目标目录规则，明确是分析、编辑还是迁移；记录读者、问题和完成判据。
2. **确定归属。** 查已有文档、领域术语和相关 ADR。更新已有所有者；新增文档时按读者与用途选择包 README、参考、教程或决策模板。规格设计与交付按 [ADR coverage](issue-tracker.md#adr-coverage-before-delivery)逐项关联决定或记录无需 ADR 的理由。
3. **核对事实。** 对照当前源码、测试、配置和脚本。执行准备写入文档的操作；凭据或外部环境不足时记录未验证条件，不声称运行成功。格式整理可保留原决定，但不能把接受状态改写成实施完成。
4. **编辑所有者。** 先更新权威文档，再更新引用、例子与图表。改变决定时新建 ADR 并交代替代关系；实施进度与执行证据更新 `.scratch/`。
5. **修复引用。** 新建、移动、改标题或删除文件后搜索入链，修复路径与锚点。新增、删除 ADR 或修改其标题、状态后运行 `bun run docs:update` 同步决策索引。核对模板中的示例及正文命令。
6. **验证与审阅。** 执行下文命令，再读完整 diff，检查事实、职责、遗漏的义务和重复表达。规格交付同时核对 ADR Coverage 与最终实现，将覆盖结论写入交付证据后再关闭 spec。报告修改结果、实际验证与剩余限制。

## 验证命令

从仓库根目录执行；配置了 RTK 的环境在命令前加 `rtk proxy`。

```sh
bun run docs:update
bun run check:docs
bunx --no -- oxfmt --check
git diff --check
```

仅文档变化运行这些检查。代码、配置、依赖或检查脚本一起变化时，先运行受影响测试与静态检查，再按根规则执行一次 `env -u NO_COLOR bun run check`，复用同一版本的结果。检查脚本测试入口为 `bun run test:docs`；它用临时目录验证合法文档与失败诊断，不修改用户配置。

`docs:update` 校验 ADR 并生成 `docs/adr/README.md` 标记内的索引，保留标记外正文；`check:dev` 在格式检查前自动执行它。`check:docs` 只读检查索引是否与文件、标题和状态一致，并扫描根 Markdown、`docs/`、`packages/` 和 `.agents/skills/` 的维护文档，校验 CommonMark 链接与图片目标、Markdown 标题及显式 HTML `id`/`name` 锚点、ADR 元数据和必需章节、skill 名称与描述。代码块和行内代码中的链接示例不参与校验；模板正文一同检查，代码块中的骨架示例不参与链接校验。`.scratch/` 历史正文不扫描，但维护文档指向历史记录的链接仍检查。

外部 URL、HTML 链接、非 Markdown 目标的锚点和未解析成 CommonMark 链接的文本需人工核对。检查不会执行示例、验证决定是否实施、判断双语一致性或维护篇幅预算；这些能力未建立专项自动检查。
