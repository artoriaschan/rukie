# 06: "本 session 允许"生成会话规则

**What to build:** 审批框的"本 session 允许"不再放行整个工具，改为生成一条更窄的会话级 allow 规则：bash 生成按字面匹配的精确整条命令；文件工具生成目标所在目录的 `/**`（glob / grep 的目标本身是目录时，取该目录）；其他工具生成裸工具名。`onPermissionAsk` 新增返回值 `allow-session`；`PermissionAskRequest` 带上 `sessionAllow: { kind, rule }`，TUI 据此显示"此命令 / 此目录 / 此工具"。追加规则后，Agent Core 重新判定挂起的 ask：命中新规则的放行，并通过 signal 让 frontend 把它移出队列。会话规则只存在内存里，越不过 deny 和 ask 规则，resume 后失效。TUI 删掉自己维护的已放行集合。

**Blocked by:** 03, 04, 05

**Status:** in-progress

参考：[spec](../spec.md)「"本 session 允许"」；User Stories 30–35。

- [x] e2e：`allow-session` 生成的规则对后续同类调用生效；越不过 deny；resume 后失效
- [x] e2e：命令含 `*` 时按字面匹配，不会变成前缀放行
- [x] e2e：多个并发的同类 ask 中，回复一个 `allow-session` 后，其余被重判放行；不同命令或目录的请求继续等待
- [x] TUI 测试：三种按钮文案按 `sessionAllow.kind` 显示（i18n）；选中后回复 `allow-session`；被撤销的请求从队列移除；auto-review 下不显示该按钮
- [x] `tsc -b` 与全量 `bun test` 通过

## Comments

### 2026-10-04 implementation checkpoint — review pending

- Agent Core `onPermissionAsk` 支持 `allow-session`，请求带 `sessionAllow.kind/rule`。Bash 会话规则使用结构化 `bash-exact`，只匹配 trim 后整串；`*` / `?` / `[]` / `{}` / backslash 等元字符保持字面。compound 与 unsafe 命令也仅能匹配相同整串；settings / CLI 常规 glob 不取得这一例外。
- 文件规则使用 canonical directory 结构化范围与 `<tool>(<directory>/**)` 描述；write/read/edit 取 realpath 目标的 parent，glob/grep 目录目标取自身、文件目标取 parent、缺省取 cwd。复用 issue 04 公开 resolver，未改 symlink 链、dangling 祖先与平台路径语义。目录名 glob 字符不会扩大邻接目录，目录中的外部 symlink 也不会继承 grant。
- 内存 collection 通过 `SessionOptions.sessionAllowRules` 按引用共享。默认只在当前 Session 留存；不写 Transcript，不从 resume 恢复。规则依旧先判 deny > ask > allow；用户 `allow-session` 可批准这次交互，但后续及挂起的显式 ask 不被内存 allow 覆盖。
- Core 持有 pending asks，追加规则后重新走规则阶段；covered request 先 resolve allow，再 abort 它的 frontend signal 撤回队列，避免 frontend 的取消 deny 改变 Core 放行结果。不同 command/directory 与 ask 规则继续等待；Run abort 与 late allow-session 不授予权限。TUI 删除整工具 allowed Set，第二项返回 allow-session，command/directory/tool 双语文案放在 common i18n，auto-review 隐藏该项。
- 并发测试在 `tests/e2e` 使用同一 Core gate + pi 公开 `runToolCall` 真实并发，包含参数准备、校验和实际工具执行；没有引入 batch prestart。pi 普通模型 batch 仍顺序准备权限请求，不声称其同时挂起多个 ask。TUI FIFO 公共交互测试验证 allow-session 回复与 signal 撤回；terminal render 验证三种双语按钮与 auto-review 隐藏，真实 TUI Run 验证 exact command 跨 Run 生效。
- TDD: Session literal-star 0 pass / 1 fail → 1 pass / 0 fail；TUI 新按钮 3 pass / 7 fail → 10 pass / 0 fail。最终相关 focused 七文件 exit 0，122 pass / 0 fail，484 assertions；tsc -b、oxlint、knip 独立通过。
- 首轮完整 check exit 1，957 pass / 9 fail，966 tests / 71 files；全部为遗漏的旧契约测试：locale 八项仍断言整工具按钮，questions 混合 FIFO fixture 将不同命令当已授权。只迁移其文案及 matching fixture，完整保留问题与拒绝行为断言；该 fixture 的目的为问题 FIFO 与匹配命令共存，不放宽新命令权限。修复 focused 两文件 exit 0，64 pass / 0 fail，184 assertions。另一次完整启动被 locale formatter 阻断，格式化后再冻结运行。
- 最终冻结实现完整验收 `rtk proxy env -u NO_COLOR bun run check` exit 0：966 pass / 0 fail，71 files，5322 assertions，110.99s；oxfmt、oxlint、tsc -b、knip 全通过。日志 `/tmp/neant-permission-06-check-final.log`。`git diff --check` 通过。base `6c4ebe271f20619cb189058f1f16165500ee7bc0`，独立分支 `codex/permission-06-session-rules`。
- 本 checkpoint 实现完成，工单保持 in-progress，Standards / Spec 双轴 code review 待父代理安排。父代理负责 main 合并、集成验收与 worktree 归档。

### 2026-10-04 review fix checkpoint — delta review pending

- 首轮独立双轴 review：Spec 0 findings；Standards 1 个 P2：直接调用 `createInteractions` 的队列测试不涉及 Session Run 或 renderer，应该镜像 `src/screens/chat/interactions.ts` 的目录，而不是放在 e2e suite。
- 将 `apps/neant-tui/tests/e2e/permission-interactions.test.ts` 移至 `apps/neant-tui/tests/screens/chat/interactions.test.ts`，仅调整相对 import，8 个既有行为断言原样保留；runtime 实现未变。
- focused 新路径 exit 0：1 pass / 0 fail，8 assertions。冻结迁移后完整 `rtk proxy env -u NO_COLOR bun run check` exit 0：966 pass / 0 fail，71 files，5322 assertions，112.95s；oxfmt、oxlint、tsc -b、knip 均通过。日志 `/tmp/neant-permission-06-review-fix-check.log`。
- 工单继续 in-progress。迁移 delta 待复审；父代理另发现实际文件工具路径 alias 与权限目标可能不一致，正在本轮路径规则范围内调查与验证，尚不 finalize。

### 2026-10-04 actual file target alignment checkpoint — review pending

- 父代理与独立 Spec reviewer 在本批集成检查中发现 issue 04 / 06 实际工具边界偏差：pi read/write/edit 会剥一个前导 `@`、规范 Unicode spaces、展开 home/file URL；read 还选择 NFD / curly quote / AMPM 文件名候选。权限原先只检查原始字符串，可漏掉真实目标的 deny。glob/grep 实际按 cwd 字面 resolve，不展开 `~`，此前权限反而展开它。
- Neant tools adapter 通过 pi 公开 `prepareArguments` 接缝保留原 edit 准备，并提前将 read/write/edit 的 path 规范成实际绝对目标；Session 的 homeDir 显式传入工具工厂，执行不再偷偷读取 process home。read 候选存在判定对齐安装 pi env.exists 的 lstat 语义：dangling symlink 仍是已有候选，只有 ENOENT 前进；其他错误交回原工具处理。
- 真实 e2e 又证明绝对 path 交 pi 后重复 Unicode normalization 会改选文件：percent-encoded NBSP URL 的目标与普通空格文件同时存在时，准备阶段选 NBSP、执行却读出普通空格文件。adapter execute 将已准备绝对 path 编码为 file URL 交 pi，再由其 NodeExecutionEnv decode 回同一资源，保留原公开工具、read 候选顺序与 mutation queue，不使用私有深导入或依赖修改。
- glob/grep 权限 target 按现有 execute 的字面 resolve 语义处理；权限规则 pattern 仍按原语法展开 home，不套用工具 aliases。issue 04 的 symlink / missing ancestor canonical resolver 其余逻辑保持。
- TDD 证据：真实 Session `read @<absolute>` 规则拒绝缺失 8 pass / 1 fail → 9 pass / 0 fail；glob/grep literal tilde target 9 pass / 2 fail → 11 pass / 0 fail；NBSP 双文件读取错误 0 pass / 1 fail → 1 pass / 0 fail。补充 deny / actual execution 的 @、percent URL、Unicode space、home 与 ordinary 路径，read fallback 外部 symlink deny、NFD/curly/AMPM 候选、read/write NBSP 双文件、missing/dangling primary error 与普通 edit 既有准备回归。所有路径夹具均为临时目录，没有触碰用户设置。
- focused 最终 exit 0：239 pass / 0 fail，9 files，723 assertions，8.95s；tsc -b、oxlint、knip 独立 exit 0。旧两项 request.args 断言精确更新为公开 prepared absolute 参数，行为断言完整保留。
- 冻结最终实现完整 `rtk proxy env -u NO_COLOR bun run check` exit 0：984 pass / 0 fail，71 files，5362 assertions，114.84s；oxfmt、oxlint、tsc -b、knip 全通过。日志 `/tmp/neant-permission-path-alias-check.log`；`git diff --check` 通过。
- 本检查点同时补齐 04 路径规则与 06 会话目录规则的真实文件工具边界，新增修复 delta 待父代理双轴 review；06 继续 in-progress，04 既有 resolved 保留，最终 spec resolved 待全部复审验收后更新。
