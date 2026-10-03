# 03: activity 双语句池与 narration 指令

Status: ready-for-agent

**What to build:** 英文环境下 activity 行全英文：思考、等待、工具动作、完成、失败、夜间、周末、节日、彩蛋、续跑、压缩、评审、审批等句子，以及完成前缀、工具计数、连击、总耗时等结构性文案；模型收到英文 narration 指令，写出的 `⏵` 状态行为英文。中文环境行为不变。见 spec Implementation Decisions 的 TUI 节（activity、narration）。

**Blocked by:** 01

- [ ] 句池沿用单文件布局，每个中文池后紧跟 `EN_` 英文镜像，对齐 dsh-working-activity 0.5.1（`~/.dsh/profiles/dsh-tui/node_modules/dsh-working-activity/src/phrases.ts`）；能对应的照搬上游 `EN_*`
- [ ] Neant 独有的 `REVIEW_PHRASES` 及比上游多出的 `ACTION_MAP` 条目自写英文，保持趣味风格
- [ ] 取句按启动时 locale 选择池子；节日与春节日期表两种 locale 共用
- [ ] 保留 BSD 版权头与 "Adapted from dsh-working-activity 0.5.1" 说明
- [ ] 结构性文案进 TUI 字典，key 对齐上游 `lang.ts`；工具计数 `-one` / `-many`（`1 tool` / `2 tools`）
- [ ] activity 改用 `@neant/i18n` 的 `fmtDuration`，删除 TUI 内旧实现
- [ ] narration 指令进字典，zh / en 两版按 locale 注入；en 版照上游 `lang.ts` 英文指令
- [ ] 测试：每个中文句池有非空 `EN_` 镜像；e2e 覆盖 en 下 activity 行文本与 narration reminder 文本；现有 narration / activity 测试在 zh 下仍通过
- [ ] `tsc -b` 与全部测试通过
