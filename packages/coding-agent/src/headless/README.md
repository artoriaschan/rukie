# Rukie Headless CLI

`rukie -p "任务"` 处理非交互 prompt；`rukie --goal "目标"` 驱动用户授权的 Goal。命令通过 Agent Core Session 执行，模型与凭据配置见[架构](../../../../docs/architecture.md)。Headless 不提供审批、Question、Plan Review 或 OAuth 回调；依赖交互的工具隐藏，Core 自发请求采用安全默认。

## 命令信息与参数

`rukie --help`（`-h`）显示共用 TUI／Headless 用法；`rukie --version`（`-v`）输出产品版本。两个入口在无终端、无模型配置时退出0，不加载 Frontend、不读取 stdin、不加载用户设置或打开 Session。帮助及参数错误根据 `LC_ALL`、`LC_MESSAGES`、`LANG` 选择中文或英文。

help／version 必须单独使用，不能与另一个信息入口、其他选项或 prompt 组合；重复同一标志可接受。未知选项、缺值、非法 boolean 值和信息入口组合错误退出2，诊断写到 stderr，stdout 不输出帮助或版本。`--` 后的内容是位置参数，不能把它用作信息入口。

`rukie [选项] [prompt]` 启动 TUI，需要交互式终端；`rukie -p [prompt]` 输出一次回复，省略 prompt 时读取管道 stdin；`rukie --goal <目标>` 驱动 Goal，与 `-p` 和位置 prompt 冲突。`--output-format text|stream-json` 仅用于 Headless，`--max-goal-rounds <正整数>` 需要 `--goal`。共用模型、恢复、权限及 MCP 参数的完整列表见 `rukie --help`；`--allow-tools <规则>...` 收集后续位置规则，用 `--` 分隔 prompt。

产品版本唯一来源是 [coding-agent manifest](../../package.json)，Frontend 将版本传给 Agent Core 的 `SessionOptions.applicationVersion`；内部包继续私有，无独立产品版本。分发机制见 [ADR-0023](../../../../docs/adr/0023-npm-cli-distribution.md)。

## 请求与输出

父 Run 结束可以早于后台 child 或 reporter。命令等待本次 prompt／Goal 的因果请求结算，包括相关子 Run、报告及报告引发的后续处理，再返回最终回答；历史 child、无关工作和空闲 anchor 不阻塞退出。Goal 沿自身稳定激活身份等待相关轮次，普通人类或 Hook 输入不替代 Goal 的最后回答。

text 模式只将结算后的最终回答写到 stdout，诊断写到 stderr。`--output-format stream-json` 每行输出一个 JSON 对象：初始 `snapshot` 是订阅时已提交状态；后续记录包含 native committed 消息／Run／工具变化和产品事件。`result` 表示一个 Run 的结果，`request_settled` 才表示对应 `requestId` 的因果终态，不能以父 `run_end` 或 `result` 判断整次命令完成。订阅前已提交的事实从 snapshot 读取，不补发历史完成事件。公开事件字段以 [SessionEvent](../../../agent/src/session/events.ts) 和 [RequestResult](../../../agent/src/session/index.ts) 为准。

prompt 成功退出0；执行或 Goal 失败退出1；argv 错误退出2。Headless 关闭前等待 `session.close()`，终止本宿主 OS Job、Hook 与连接资源；durable Task 和活 OS 进程是不同资源，恢复不重建旧 Job。

## 中断与恢复

可执行入口接收 SIGINT 和 SIGTERM，调用同一宿主 close 路径并等待资源释放，分别以130和143退出，stderr 显示 Interrupted。中断不把已接受的未完成工作保存为取消或成功；下次 `rukie --resume <id> -p ""` 继续当前请求，之后可提交新 prompt。工具已进入 unsafe 执行阶段时，中断恢复保留真实未知结果，不重放副作用。资源清理或存储失败仍传播实际错误。

启动期间的信号也取消正在等待的 SessionStart Hook，并在返回前等待初始化资源释放。此时尚未接受的 prompt 不会被伪造为待恢复请求；打开完成后的退出继续沿 Session close 合同保留已接受任务。

嵌入调用使用公开 `main` 与 IO `signal`：host signal 关闭 Session 并取消未完成 stdin 读取，保留 durable 工作；其 Headless 中断返回130。SIGTERM143由可执行入口的信号身份映射，不会改变嵌入调用的接口。具体生命周期见 [ADR-0024](../../../../docs/adr/0024-adopt-pi-durable-harness.md)。
