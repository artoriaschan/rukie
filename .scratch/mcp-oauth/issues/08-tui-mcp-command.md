# 08: TUI /mcp 报告与子命令

**What to build:** TUI 用户用 `/mcp` 查看各 MCP server 的状态，用 `/mcp login|logout|reconnect <server>` 主动登录、登出、重连。照 dsh-TUI 的 `/mcp` 复刻。详见 [MCP OAuth spec](../spec.md) 的 TUI 一节。

**Blocked by:** 06, 07

**Status:** resolved

- [x] 新增内置 Slash Command `/mcp`；不带参数时 run 进行中也可用；调用 `mcpServers()`，以多行 notice 写入 transcript：`! /mcp` 标题行（bashBorder 色），内容行 dim、缩进 2，依次为 `MCP 服务器（N）`、`name · status · N 个工具`、有 needs-auth 时的提示行；空状态显示配置路径；首次探测时显示 loading 文案。现有 notice 渲染不了时加 `report` 变体
- [x] 子命令 `login|logout|reconnect <server>` 只能在空闲时用，分别调用 `authenticateMcp` / `clearMcpAuth` / `reconnectMcp`；成功和失败用 notice（文案照 spec）；缺参数时用 warning 显示用法；run 进行中显示现有的 busy 提示
- [x] 补全两层：子命令（带描述）、server 名（来自最近一次 `mcpServers()`）
- [x] zh / en 文案、`/help` 列表同步
- [x] TUI e2e：各种状态行、needs-auth 提示行、空状态、loading；run 进行中能执行 `/mcp`、子命令显示 busy；`login` 打开 07 的面板，完成后出现成功 notice；`logout` 后再执行 `/mcp` 显示 needs-auth；缺参数；补全
- [x] 用真实托管 server（如 Notion 或 Linear 的 MCP）手动走一遍完整流程，记录在工单中

## Comments

- `/mcp` 使用 Session 的公开 `mcpServers()`；初次真实探测尚未完成时记录 loading，本地报告以现有 notice 的 report 变体呈现。Core 已记录 Run 快照时，首次 frontend 报告直接读取最新结果；后续报告也先读取 Core 当前快照，避免模型授权后第一次报告仍显示旧 needs-auth。只保存近期结果用于补全，Frontend 不重建 Core 状态。
- `login` / `logout` / `reconnect` 复用公开 Session API，管理操作与快照刷新完成后才显示瞬时结果通知；已有授权面板原样复用，取消显示 dim，错误通过 frontend formatter 本地化。API callback 的 origin 与 signal 保留在原有 07 路径。管理期间拒绝另一管理命令，Run 中复用现有 busy 提示。
- 补全分为带描述的三种控制动作与缓存服务器名，Tab 补全草稿；已有内置命令、Skill、键盘与鼠标选择路径保持原有行为。普通 slash parity 的数量、窗口 footer 和从最后一项返回 help 的步数仅调整新增一项 `/mcp` 的差值。
- 公开 `start` / headless terminal e2e 使用 Agent Core 已有 fake OAuth/MCP runtime fixture；覆盖状态、pending loading、完整登录/登出/重连报告、失败/取消、Run 中读与 busy、用法、help/两层补全、zh/en 40×12/resize、resume 不保留报告、替换 Session 丢弃晚到 probe，以及模型授权后的第一个报告与 Core 既有 Run 快照。
- TDD red：未知 `/mcp` 首先进入模型；接通本地 report 后精确 dsh 颜色检查发现缺少 `bashBorder` token；管理命令没有打开面板；两层补全缺失；缓存 needs-auth 在模型授权后第一次报告仍过期；Core 已有记录时 frontend 首次报告误显示 loading。分别在所属层实现后转绿。新 token 的 dark `#D194AE` / light `#C07A93` 对照当前 dsh 对应 palette，其余主题值未变。
- 当前命令单文件：12 pass / 0 fail，41 assertions；types、lint、Knip 通过。最终 isolated focused：TUI MCP commands / OAuth panel / slash commands / slash menu parity / question parity 与 Core MCP API 共 91 pass / 0 fail，500 assertions（27.07 s）。完整 `env -u NO_COLOR bun run check` 在临时 HOME 下 exit 0：2298 pass / 0 fail，11771 assertions，166 files（311.32 s）；format、lint、types、Knip 全通过。
- 真实托管账户完整授权验收由 root 执行，仍未完成；最后一项保持未勾选，Status 保持 claimed。root 已执行 Notion passive discovery，结果 needs-auth / oauth / toolCount 0、未调用模型；此证据只证明发现，不能替代完整账户登录验收。
- Standards / Spec 自审：仅新增 notice report 变体，不新增 Transcript 行类型；普通命令、提问、图片及通知路径保留，MCP 状态与授权由公开 Core API 拥有。TUI README 与通用主题 README 已同步；最终集成分支 `b8310aa` 已包含在基线，正式两轴 review 由 root 后续执行。
- 2026-10-06，最终集成：代码与后续审查修复已进入 `codex/mcp-oauth`，集成提交 `ca35ecd`。独立 Standards / Spec 审查发现的四项问题由一个实现代理统一修复，两个原审查代理复核通过；完整隔离检查 2309 pass、0 fail（166 files），集成源码与完整测试快照完全一致，另跑集成组合 212 pass、0 fail 及静态检查全部通过。包含本票在内的 9 个实施 / 审查 worktree 已确认归档。
- 2026-10-06，真实 Notion 验收尝试：使用生产 TUI `start`、默认系统浏览器 host 和临时 HOME，将 `notion` 配置为 `https://mcp.notion.com/mcp`。首次 `/mcp` 正确显示 needs-auth，未调用模型或打开浏览器；`/mcp login notion` 显示真实授权面板，并成功通过系统浏览器打开授权页。等待窗口内没有完成账号授权，未取得成功回调；本次验收脚本以未完成授权退出，临时项目、HOME 与凭据已清理。日志 `/tmp/neant-mcp-oauth-live-tui.log`。
- 真实服务的登录成功、后续无交互凭据复用、logout / reconnect 完整链路仍未验收，最后一项保持未勾选。需要用户在浏览器完成账号登录和授权后重跑；`ready-for-human` 只表示剩余账号验收需要人工操作，代码实现已完成。fake server 的同链路测试、macOS 浏览器 / 剪贴板手动检查均已通过，不能替代该真实账户条件。
- 2026-10-07：用户确认已用真实托管账户完成手动验收（登录、凭据复用、logout / reconnect）。最后一项勾选，状态改为 resolved。
