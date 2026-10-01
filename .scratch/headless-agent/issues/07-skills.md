# 07: Skills

**What to build:** agent 能发现并使用符合 Agent Skills 规范的 skill。

- **发现**：在用户级和项目级的 `.neant/skills`、`.claude/skills`、`.agents/skills` 中查找（使用 pi 的 `loadSkills`）。重名时项目级优先；格式有问题的 skill 跳过并给出警告。
- **注入**：skills 的名称和描述列表通过 System Reminder 注入，resume 时如果列表有变化，补发增量。
- **加载**：模型通过 `skill` 工具（属于只读工具，默认放开）按名称加载正文。
- **Skill Invocation**：用户在 prompt 开头写 `/name` 时，对应 skill 的正文作为 reminder 附在这条消息上，用户原话保持不变；找不到对应 skill 时，prompt 按普通文本原样发送。

**Blocked by:** 04, 06

**Status:** resolved

- [x] 六个发现路径都能生效，重名时项目级优先，坏掉的 skill 只产生警告
- [x] `skill` 工具加入只读集合，能按名称返回正文；名称不存在时返回 `isError`
- [x] skills 列表作为 06 增量机制的一个来源，列表变化时 resume 会补发
- [x] `/name` 展开正确；`/不存在的名字`（例如以 `/` 开头的路径）原样发送
- [x] Seam 1 测试覆盖以上所有行为

## Comments

- 2026-10-01：每个 Run 用 pi 0.99.2 的 `loadSkills` 发现用户级和项目级的六个 skills 目录；先加载用户级，再加载项目级，按名称合并。跳过 pi 带诊断返回的非法 skill，并补查其默认目录名回退未校验的必填 `frontmatter.name`。警告带文件路径，通过 `SessionOptions.onWarning` 交给前端，默认写 stderr；CLI 两种输出模式都只在 stderr 显示警告。
- `skill` 加入默认只读权限集合，按名称返回正文及原始文件位置、相对引用目录；未知名称由 pi loop 转为 `isError`，Run 可继续。
- 名称和描述的稳定排序列表作为 `skills` reminder 来源接入 06 的比较机制；新增、删除或描述变化会补发，清空列表时明确注入 `Available skills: none.`。每个 Run 刷新发现结果，正文变化不影响列表比较，工具使用当前正文；旧 reminder 和 Transcript 前缀保持原样。
- prompt 开头独立的 `/name` 匹配成功时，在原始 user 消息之后追加 `skill-invocation` reminder，正文不会替换用户原话；每次显式调用都会展开。未知名称、非开头调用、`/review/file.ts` 等路径都原样发送。
- Seam 1 新增 20 个测试，覆盖六路径、跨命名空间项目优先、坏格式跳过与警告、默认权限和错误恢复、列表增量及清空、正文刷新、Invocation、未知路径和 resume 的模型上下文及 JSONL 前缀；Seam 2 增加 text/stream-json 的真实 CLI 验证。
- 验证：`bun run check` 通过（格式、lint、`tsc -b`、knip、全量 91 个测试 / 445 个断言）；`/code-review` 规范轴与规格轴各 0 项发现。
