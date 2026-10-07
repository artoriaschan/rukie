# 04: 子代理类型与模型

**What to build:** `subagent` 增加 `subagent_type?` 参数。

- 内置类型：`general-purpose` 与 `explore`。`explore` 只有 `read`、`glob`、`grep`、`skill`、`todo_write`，有回调时加 `ask_user_question`。
- 自定义类型：从用户层和项目层的 `{.neant,.claude,.agents}/agents/*.md` 加载。frontmatter 为 `name, description, tools?, model?`，正文为附加系统提示。项目层覆盖用户层，自定义覆盖内置。`tools` 与 general-purpose 工具集取交集，未知工具名告警。坏文件经 `onWarning` 告警（带路径）后跳过。不要求 trusted。
- `subagent` 工具描述列出可用类型，每次 run 开始刷新。未知 `subagent_type` 时报错并列出可用类型。
- 子代理系统提示为：父 System Prompt + 委派说明 + 类型正文。
- settings 增加 `subagentModel`。模型取值顺序：类型 `model` → `subagentModel` → 父模型。解析失败时报错，不回退。

Blocked by: 02

Status: resolved

参考：[spec](../spec.md)「类型」「模型与配置」。

- [x] e2e：`explore` 子代理的首次请求只带只读工具；自定义类型 `tools` 取交集
- [x] e2e：临时目录里的 `agents/*.md` 出现在工具描述里；项目层覆盖用户层；坏文件告警后其余类型照常可用
- [x] e2e：未知类型报错并列出可用类型；子代理系统提示含类型正文
- [x] e2e：模型取值优先级（用不同 faux model 区分）；非法模型报错
- [x] settings 测试：`subagentModel` 的解析与非法值报错
- [x] `docs/tech-stack.md` 无需变动（无新依赖）；`tsc -b` 与全量 `bun test` 通过

## Comments

- Implemented type discovery, public `subagent_type` selection, tool intersection, type prompts, and model precedence with no new dependencies. Tests use public Session/model requests and `loadSettings`.
- Validation: `bunx tsc -b` passed; `env -u NO_COLOR bun run check` exited 0 with 1022 pass / 0 fail / 5522 assertions across 74 files (112.36s). Check log: `/tmp/neant-subagent04-check-final.log`.
- Initial dynamic descriptions now seed pi's first declaration before its baseline is created; subsequent Runs refresh with connected MCP tools. Existing event/transcript/narration checks pass without changing their assertions.
- Independent two-axis review completed for implementation `795d1ba441302a18d7b05634cacca3667c52cee7` against fixed base `f16ea9e2253ae925f8b6ef3abe36f230e50af7cd`; the fixed point and non-empty diff were verified. Standards: `/root/review04_standards`, 0 findings. Spec: `/root/review04_spec`, 0 findings; reviewer independently ran 53 focused tests, all passed.

## Answer

已实现 `subagent_type` 的选择与发现：内置 general-purpose/explore，自定义类型按用户层到项目层加载，并覆盖同名内置类型。工具集只取父 general-purpose 工具交集（含实际连接的 MCP 工具），未知工具和坏文件带路径告警后忽略。类型描述每次 Run 开始刷新，未知类型返回可用清单，子 System Prompt 追加委派说明和类型正文。

`subagentModel` 可由项目层覆盖用户层；子模型按类型 model → subagentModel → 父模型选择，使用现有 resolveModel，解析失败直接返回错误。未引入新依赖。

### Standards

独立审查：0 findings。

### Spec

独立审查：0 findings。公开 Session/settings 用例和完整 check 的验证证据见 Comments。两轴均无待修复项，本票据 resolved；与 03 的整合及 main 验证由协调线程负责。
