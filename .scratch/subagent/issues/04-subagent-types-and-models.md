# 04: 子代理类型与模型

**What to build:** `subagent` 增加 `subagent_type?` 参数。

- 内置类型：`general-purpose` 与 `explore`。`explore` 只有 `read`、`glob`、`grep`、`skill`、`todo_write`，有回调时加 `ask_user_question`。
- 自定义类型：从用户层和项目层的 `{.neant,.claude,.agents}/agents/*.md` 加载。frontmatter 为 `name, description, tools?, model?`，正文为附加系统提示。项目层覆盖用户层，自定义覆盖内置。`tools` 与 general-purpose 工具集取交集，未知工具名告警。坏文件经 `onWarning` 告警（带路径）后跳过。不要求 trusted。
- `subagent` 工具描述列出可用类型，每次 run 开始刷新。未知 `subagent_type` 时报错并列出可用类型。
- 子代理系统提示为：父 System Prompt + 委派说明 + 类型正文。
- settings 增加 `subagentModel`。模型取值顺序：类型 `model` → `subagentModel` → 父模型。解析失败时报错，不回退。

**Blocked by:** 02

**Status:** ready-for-agent

参考：[spec](../spec.md)「类型」「模型与配置」。

- [ ] e2e：`explore` 子代理的首次请求只带只读工具；自定义类型 `tools` 取交集
- [ ] e2e：临时目录里的 `agents/*.md` 出现在工具描述里；项目层覆盖用户层；坏文件告警后其余类型照常可用
- [ ] e2e：未知类型报错并列出可用类型；子代理系统提示含类型正文
- [ ] e2e：模型取值优先级（用不同 faux model 区分）；非法模型报错
- [ ] settings 测试：`subagentModel` 的解析与非法值报错
- [ ] `docs/tech-stack.md` 无需变动（无新依赖）；`tsc -b` 与全量 `bun test` 通过
