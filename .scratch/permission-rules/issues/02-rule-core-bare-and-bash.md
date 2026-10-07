# 02: 规则核心：裸名与 bash 规则

**What to build:** 用户在 `~/.neant/settings.json` 写 `permissions.{allow,ask,deny}`，用裸工具名 glob 或 `bash(pattern)`（这一张先只按单条命令匹配整串）放行、询问或拒绝工具调用。deny 和 ask 规则在所有 Permission Mode 下都生效；ask 规则在 auto-review 下直接问用户，不发起 review；allow 规则跳过询问和 review；按 deny > ask > allow 取最严。被规则拒绝时，模型收到 `Denied by permission rule: <规则>`；`permission_denied` 事件带 `by: "rule" | "user" | "review"` 和可选的 `rule`，stream-json 自动带出，TUI 工具卡显示规则原文。规则写错（未知工具带 specifier、空串、括号不闭合）时，加载报错并指出文件和规则。本工单不动 `allowTools`（expand）。

Blocked by: 01

Status: resolved

参考：[spec](../spec.md)「Permission Rule」「拒绝反馈」；User Stories 1–3、7–8、14–18、27–29、36–37、42。

- [x] shared 的 settings schema 新增 `permissions`；规则在加载时解析为结构化形式
- [x] 规则判定纯函数作为新测试接缝，表驱动覆盖裸名 glob、bash glob（`*` 可跨空格、去掉首尾空白）、取最严、语法错误
- [x] e2e：deny 在 full-access 下仍拒；ask 规则在 full-access 下仍问；ask 规则在 auto-review 下不发起 review；allow 规则在 ask 模式下不询问
- [x] e2e：规则拒绝的 tool result 文案，以及 `permission_denied` 的 `by` / `rule`；用户拒绝与 review 拒绝分别带 `by: "user"` / `"review"`
- [x] Headless 下命中 ask 规则时按 deny 处理，stream-json 带 `by`
- [x] TUI 工具卡在 `by: "rule"` 时显示规则原文（i18n）
- [x] `tsc -b` 与全量 `bun test` 通过

## Comments

- 2026-10-04: 实现 checkpoint，待 Standards / Spec 双轴 review 后再 resolved。新增 `permissions.{allow,ask,deny}` 语法解析与纯规则判定接缝；只匹配裸工具名和 bash 整串文本，保留 `allowTools`，路径 specifier 仅解析结构，实际路径匹配及项目规则来源分别归 04 / 05。
- Red → green：规则纯函数初始缺模块（exit 1）；settings 与 Session 新行为测试 13 fail（exit 1），接线后 36 pass / 0 fail；补充 bash glob 路径分隔符文本匹配 1 fail → 20 pass / 0 fail。批量 review 测试覆盖参数校验转换、缺参，以及 rule allow / ask / deny 不发起 review；review deny / 失败的无人交互与用户拒绝均验证 by 来源。
- 验收：最终 focused（规则纯函数、Session rules、TUI live/resume）45 pass / 0 fail，exit 0；`rtk proxy env -u NO_COLOR bun run check` 最终 exit 0，810 pass / 0 fail，65 files，4877 assertions。格式 / lint / `tsc -b` / knip 同时通过。Headless stream-json 的显式 ask / deny 带 `by: "rule"` 及原文规则，中英文 TUI 实时与 resume 工具卡均覆盖。

- 2026-10-04 review 修复 checkpoint：Spec 轴 0 findings；Standards 轴两项 hard findings 已修复，待复审修复部分后 resolved。config / session 与规则纯函数测试只从 permissions/index 公共 API 引用；非法权限规则新增 shared typed error `permission-rule-invalid`，参数保留 source 和未经 trim 的 rule 原文，common 中英文及 TUI formatError 同步。不改旧 settings 校验错误。
- 修复验收：新增公开配置错误与 TUI 中英文启动错误测试 red 60 pass / 4 fail → focused 108 pass / 0 fail（235 assertions / 4 files，exit 0）；独立 `tsc -b` exit 0。冻结修复代码后的 `rtk proxy env -u NO_COLOR bun run check` 最终 exit 0，817 pass / 0 fail，65 files，4904 assertions，112.39s；格式 / lint / typecheck / knip 全部通过。

- 2026-10-04 最终 review：原 Standards 两项 hard findings（跨概念内层引用、非法规则裸英文错误）均已修复。对 `ebcc619...eeb6e6c` 修复 delta 的独立 Standards / Spec 双轴复审均 0 findings，无新增问题；issue02 resolved。最终代码验收沿用冻结代码后的完整 check：exit 0，817 pass / 0 fail；本次仅更新票据，不改代码。
