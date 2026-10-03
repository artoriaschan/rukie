# 05: 权限规则 / hooks / checkpoint 参考实现调研

Type: research
Status: resolved
Blocked by: None

## Question

Claude Code（公开文档）、Codex CLI（公开文档）、deepseek-harness（本地源码）如何实现以下三项？

- 权限规则：规则语法（命令前缀、glob、路径）、allow/deny/ask 层级与优先级、配置层级（用户 / 项目 / 本地）、bash 复合命令（`&&`、管道）拆分。
- hooks：事件种类、脚本输入输出协议、能否阻断或改写、超时。
- checkpoint / 撤销：快照粒度（每轮 / 每次写）、存储方式（git 影子仓库 / 文件副本）、bash 产生的改动能否回滚、与对话回退的关系。

产出带引用的对比，标注各方案对拦截点（地基 C）的要求。

## Answer

**权限规则。** CC 用 `Tool(specifier)`，Bash 支持 `*` 通配和包装剥离，Read/Edit 用 gitignore 路径语法；判定顺序固定为 deny → ask → allow，各配置层的规则合并，任一层 deny 即生效（[permissions](https://code.claude.com/docs/en/permissions)）。Codex 用 Starlark `prefix_rule`，多条命中时取 `forbidden > prompt > allow`，规则写在每层的 `rules/*.rules`，项目层要先被信任才加载（codex `execpolicy/README.md`，`core/src/exec_policy.rs:662-716`）。DSH 没有规则，只有 sandbox mode × approval policy 两个旋钮组成的 preset（`permission-presets/src/index.ts:182-199`）。

**复合命令拆分。** CC 和 Codex 都按 `&&`、`||`、`;`、`|` 拆成子命令逐个判定，取最严结果。Codex 用 tree-sitter，遇到不认识的语法就整条命令一起判定（`shell-command/src/bash.rs`）。CC 文档明说 Bash 规则不是安全边界，要靠 sandbox 兜底。

**"一直允许"的持久化。** CC 写入 `settings.local.json`，Codex 追加到 `default.rules`。

**hooks。**

- CC 有 33 种事件，Codex 有 12 种，DSH 只是兼容桥。
- 协议三家一致：stdin JSON，exit 2 表示阻断。
- 结果可以是 deny/ask/allow，合并取最严，另外都能用 `additionalContext` 注入上下文。
- CC 和 Codex 支持 `updatedInput` 改写参数，DSH 有意不支持。
- 默认超时都是 600s。
- CC 的 hook 返回 allow 也绕不过规则的 deny/ask（[hooks](https://code.claude.com/docs/en/hooks)）。

**checkpoint。**

- CC 每个 prompt 记一个 checkpoint，只跟踪文件工具的改动，不跟踪 bash；可以选只回代码、只回对话或两者都回（[checkpointing](https://code.claude.com/docs/en/checkpointing)）。
- Codex 的 ghost commit 每轮做一次整树快照，能覆盖 bash，但已在 2026-04 移除；现在的对话回退不回滚文件。
- DSH 用影子 git 做每轮快照，只用来展示 diff，不能回滚。

**对地基 C 的要求。**

- 阶段顺序固定：hooks（可改写参数）→ 规则（按改写后的参数判定）→ 模式/审批 → 执行 → post。
- 结果类型 `allow | deny(reason) | ask(reason)`，加上可选的改写和上下文；合并取最严；部分拦截器只能收紧不能放宽。
- ask 阶段走地基 A，要能返回会话内允许或生成规则；Headless 下 fail-closed。
- post 阶段能阻断、替换结果、注入上下文，但不能撤销副作用。
- checkpoint 二选一：挂在写工具前逐文件捕获（覆盖不到 bash），或改挂 turn 生命周期做整树快照。
- 内置工具、MCP、skill 走同一条链；子代理只能比父收得更窄。

详见 branch research/rules-hooks-checkpoint-prior-art:docs/research/rules-hooks-checkpoint-prior-art.md
