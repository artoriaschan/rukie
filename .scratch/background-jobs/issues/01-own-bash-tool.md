# 01: 自研 bash 工具（前台行为不变）

**What to build:** 用 Agent Core 自研的 bash 替换 pi `createBashTool`（ADR-0010），为后面的 Background Job 准备好单一执行路径。模型侧行为与现在一致，只多 `description`（必填）和 `workdir` 两个参数。详见 [后台 bash spec](../spec.md) 的 bash 工具一节。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 命令以 detached 方式在独立进程组中启动；终止时先向进程组发 SIGTERM，3 s 后发 SIGKILL
- [x] 参数为 `command`、`description`（必填）、`timeout?`（秒，默认 120，上限 600）、`workdir?`（相对 session cwd 解析）；`run_in_background` 暂不加
- [x] 截断规则、spill 路径提示、退出码非 0 报错、`(no output)`、超时报错、abort 报错与现有 pi 行为一致；复用 pi 的 truncate / output-capture 工具函数
- [x] 删除 pi bash 的接入代码与 120 s 包装，只留一条执行路径
- [x] 现有 bash 相关 e2e（超时、abort 杀子进程、权限规则、hooks、full-access）不改断言，全部通过
- [x] 新 e2e：`workdir` 生效；abort 时孙进程也被终止；缺少 `description` 时返回参数校验错误

## Answer

Agent Core 的 `bash/` 现在拥有唯一的前台执行路径，替换 pi bash 与默认超时包装。命令在独立进程组中 detached 启动，取消与当前前台超时先发 SIGTERM，再于 3 秒后升级为 SIGKILL；shell 退出时补发 SIGTERM 覆盖 fork 竞态。新增必填 description、相对 Session cwd 的 workdir，保留默认 120 秒与 600 秒上限，尚未开放 run_in_background。

通过锁定的 pi 0.99.2 输出采集适配器复用 OutputCapture，并继续使用公开 applyShellOutputUpdate、truncate 常量与 formatSize。适配器记录私有路径约束及移除条件；输出截断、spill 提示、空输出、非零退出码、信号退出、超时和取消结果保持前台语义。

既有模型和 Hook 输入明确增加 description；工具结果与权限行为断言保留。TUI 审批参数详情忽略 description 标签元数据，使原有 Shift+Tab 与审批布局断言不变。Context Usage 测试窗口改为 12100，明确覆盖非整数网格占用，保留四种符号断言。旧 Transcript 的 Unknown Tool Outcome 输入仍保留原始无 description 形式，恢复行为不变。

## Verification

- 基线：tools.test.ts + bash-permission-rules.test.ts，20 pass / 0 fail。
- TDD：workdir 公共 Session e2e 在旧 pi bash 上因读取错误目录失败，改为自研路径后通过；现有取消 Hook 用例揭示的 fork 信号竞态也已修复并验证。
- 新 bash.test.ts：9 pass / 0 fail，覆盖 workdir、缺 description、前台输出与退出码、孙进程取消、完整 spill 与 SIGTERM/SIGKILL 升级。
- 重点恢复、权限、侧问和 TUI 用例：64 pass / 0 fail；无 description 的旧 Transcript 恢复专项：18 pass / 0 fail；Context Usage 四符号专项通过。
- 使用临时 HOME，`env -u NO_COLOR bun run check`：exit 0；2210 pass / 0 fail，11420 expect calls，160 files，296.83 s。日志 `/tmp/neant-background-01-final-check.log`。
- Markdown 格式与 `git diff --check` 通过。
