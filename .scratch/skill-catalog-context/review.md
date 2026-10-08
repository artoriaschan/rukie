# Skills catalog context reduction

2026-10-09：按用户列出的四项控制，对照 deepseek-harness 的 tool-skill 实现，在当前 `codex/custom-model-compat` 分支交付。

## Scope and implementation

- 描述合并连续空白、去首尾空白，规范化后最多 500 字符，超出保留 497 字符并追加 `...`；目录只含名称和描述，正文、绝对路径与 whenToUse 不进入条目。
- 过滤 disable-model-invocation 技能，skill 工具也拒绝加载该类技能。用户直接 /name 仍可加载；user-invocable false 与 Frontend 列表一致，不展开 slash 文本。
- 模型通过 skill({ name }) 获取完整正文；显式用户调用保留原 prompt，注入完整正文及避免重复加载的提醒。
- 对规范化、转义后的条目计算摘要，与当前原生模型上下文中仍有贡献的目录比较。未变不追加，改变发布完整替换；初始空目录不发布，旧目录变空时清空旧名单。父子 Session 按自己的 skill 工具可见性处理；Compaction、Resume 与 Rewind 使用当前投影，不另存发布状态。目录摘要不额外占用模型 token。

## Verification

- 新的公开 Session 用例先 RED：描述无限长、用户专用技能被模型目录曝光、初始空目录仍发布均有复现；随后 GREEN。Compaction fixture 使用两次真实文件读取和受保护的最近 Run，触发锁定 harness 的真实摘要流程。
- skills 文件最终 27 pass、0 fail、1.405s；新增用例约 30–115ms，无新增超过 1s 的用例。提醒、Todo 和中断相关最初 54 pass、0 fail、2.77s；真实 CLI 进程、Compaction、fork 与子工具调用方 108 pass、0 fail、25.44s，该组保留已有进程启动成本。
- 一次完整 `env -u NO_COLOR bun run check`：静态和文档检查通过；3134 pass、6 fail、17920 assertions、286 files、104.78s。四个 session-list/resume-picker 失败是空 skills reminder 删除后旧消息数 6 的断言，最小复现 0 pass、4 fail；只将当前消费者更新为 5，没有改产品列表或 UI。
- 剩余完整检查失败为 subagent dashboard 混合状态终端等待超时、MCP FIFO 屏幕中回答尚不可见；最小复现这两个文件的相关三项用例全部通过（3 pass、0 fail、1.493s），未更改无关 UI。保留完整运行的实际失败记录，未把局部通过称为完整通过。
- 完整检查后还将可见提醒提取限制为 rukie.reminder 条目，避免为了读取技能目录克隆整个对话。它只优化同一 skills 投影路径，不改变其他来源；相关公开技能、提醒、Todo、会话列表和 picker 54 pass、0 fail、295 assertions、3.36s，check:dev 与 git diff --check 通过。按仓库一次最终完整运行规则，消费者断言与这个局部提取优化使用 focused 结果，不重复完整测试。
- 当前本机发现 93 个技能、模型目录 70 个：旧渲染 24684 字符，新渲染 20546 字符，降低约 17%。只测目录字符数，不声称 provider 实际 token 降幅；没有修改真实用户配置或 Session。

## ADR coverage and review

本次恢复现有 Skill 概念的按需正文与调用可见性要求，目录事实仍通过既有 System Reminder 写入 Transcript，摘要从当前模型投影推导，不新增持久化状态或执行循环。沿用 ADR-0011 的能力所有权、ADR-0016 的上下文与完整历史区分及 ADR-0024 的原生 projection/Compaction；不改变它们的决定，无需新增 ADR。标准与四项行为审阅完成，已更新 Agent README、CONTEXT 与架构模块职责，没有未解决的本任务发现；完整运行中两项未复现的 TUI 失败是保留的验证限制。
