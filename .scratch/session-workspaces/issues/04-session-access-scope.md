# 04：Session 访问范围

Status: claimed

**What to build:** 按 [spec](../spec.md#session-访问范围工单-04) 与 [ADR-0044](../../../docs/adr/0044-session-access-scope.md)，在 Agent Core 权限模块按访问范围决定文件工具的模式默认值。

- [x] 计算范围：cwd、附加目录（读写），已发现技能根、本 Session Job 输出目录（只读）；按真实路径判定
- [x] `read`/`glob`/`grep`/`write`/`edit` 的模式默认值按 ADR 表格；hooks、规则、Permission Review 阶段与 `bash`/MCP/`web_fetch` 不变
- [x] 目录级“本 session 允许”沿用；子 Session 使用父范围；Headless CLI 无回调时范围外拒绝
- [x] 测试：`createSession` + fake model 覆盖范围内外三种模式、只读范围写入询问、技能引用文件放行、显式 deny/ask 优先、目录授权覆盖子路径、子 Session、Headless 拒绝与 `--allow-tools` 放行；更新依赖“读取全局放行”的既有用例
- [x] 文档：docs/permission-rules.md、Agent README、CONTEXT.md 新增 Session 访问范围词条

## Comments

- 2026-10-14：已实现，保持 claimed 等待 integration 的最终审阅与聚合验证。权限模块按真实路径计算可读写／只读根，只替换模式默认阶段；父子共用动态范围（包含技能刷新与 Job 输出目录），现有目录临时授权和 hooks / 显式规则优先级不变。文档同步权限参考、Agent / Headless README、CONTEXT。
- TDD seam：spec 已授权 `createSession` + fake model 与 Headless CLI；首次 red 1 fail（259 ms）：范围内两次 write 询问、范围外 read 未询问，日志 `/tmp/rukie-session-workspaces-evidence/04-red.log`。首次 green 1 pass（225 ms）。最终新范围公开用例 9 pass / 38 assertions（1.310 s），每例 65–205 ms，日志 `04-scope-final.log`。
- 影响调查：原权限／评审用例用 cwd 写入制造审批，现改成 home 下范围外文件；别名读写执行用例增加明确 read allow；TUI pending 卡片用例用显式 ask 保持其展示合同，命令授权用例的其他文件目标移到范围外。原失败证据见 `04-impact.log`（中断的探索运行）与 `04-impact-2.log`（151 pass / 10 fail），后者失败全部由默认值变化引起并在 focused 中修复。
- 有效增量证据：`04-focused.log` 114 pass / 384 assertions（5 files, 6.56 s）；`04-remaining-consumers.log` 66 pass / 260 assertions（6 files, 7.50 s）；`04-new-final.log` Headless 明确拒绝／allow-tools 与范围继承等 14 pass / 46 assertions（4 files, 1.52 s）；`04-last-consumers.log` tools 与 TUI 2 pass / 20 assertions（851 ms）。前三个已通过的 subagent / denial / hook 文件共 47 cases 在 `04-impact-2.log` 中有逐例通过证据，可复用。
- 生命周期和 TUI 现有消费者中的超 1 s 用例保留原有真实子进程／多次 Session 打开合同；新增每例均低于 1 s。只运行票据聚焦测试，root 负责最终 check:dev、共享权限执行基础设施的聚合 check 与 GUI 验收。格式化与 `git diff --check` 通过；未宣称 CI 验收。
