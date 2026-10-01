# 04: 内置工具与权限

**What to build:** agent 能用 read、write、edit、bash（pi 自带）以及 glob、grep（自己实现）来完成编码任务，并且受权限控制：

- 默认只放开只读的 `read`、`glob`、`grep`（`skill` 工具在 07 加入只读集合）。
- 用户可以用 `--allow-tools <pattern...>`（glob 模式）、settings 里的 `allowTools`，或者 `--yolo` 放开更多工具。
- 没有授权的调用不会执行，而是以 `isError` 告诉模型"该工具未获授权"，同时发出 `permission_denied` 事件。
- 权限判定是一个纯函数，返回 `allow`、`deny` 或 `ask`；headless 模式下 `ask` 按 `deny` 处理。

**Blocked by:** 02

**Status:** resolved

- [x] glob 基于 `Bun.Glob`，遵守 `.gitignore`
- [x] grep 调用内置 `rg`；内置二进制无法加载或启动时，工具返回带依赖修复提示的错误，进程不崩溃
- [x] bash 有超时；Run 被中止时会终止子进程
- [x] 工具抛出的异常作为 `isError` 结果返回给模型，不中断 Run
- [x] 判定挂在 `beforeToolCall` 上；CLI 的模式、settings 的 `allowTools` 和 `--yolo` 三种放开方式都能生效
- [x] Seam 1 测试覆盖：默认拒绝写类工具和 bash；用 glob 模式放开；yolo 放开全部；被拒时模型收到的错误内容和 `permission_denied` 事件；grep 和 glob 在临时仓库里的结果

## Comments

- 2026-10-01：注册 pi 0.99.2 的 read/write/edit/bash，通过适配器将 Agent 的 AbortSignal 传入 harness context；bash 默认超时 120 秒，模型可指定 timeout（秒），中止时由 pi 终止整个进程组。
- permissions 是单独的纯判定函数，决策类型为 allow/deny/ask；当前策略只产生 allow/deny，headless hook 对任何非 allow 决策都阻止执行。默认只允许 read/glob/grep，skill 在 07 加入；settings.allowTools 与 SessionOptions.allowTools 合并，yolo 允许全部。拒绝结果包含“该工具未获授权”并发出带 toolCallId/toolName/sessionId 的 permission_denied 事件。
- glob 使用 Bun.Glob 扫描和匹配，ignore 7.0.8 处理根目录、嵌套及否定规则，剪枝忽略目录与 .git，不遍历目录符号链接；搜索子目录及从 Git 仓库子目录启动 Session 都保留适用的祖先规则，支持 worktree 的 .git 指针文件。
- grep 通过参数数组调用 rg，返回文件名、行号和匹配文本；无匹配不是错误，输出截断时提示缩小搜索范围。缺少 rg 时提供 macOS/Linux 安装命令，错误作为 isError 交给模型；工具异常由 pi loop 转为错误结果，Run 可继续。
- CLI 支持 --allow-tools <pattern...>、重复传参、--allow-tools=<pattern> 和 --yolo，错误参数退出 2。Seam 2 使用真实 CLI 子进程和假的 OpenAI 服务验证默认拒绝、模式授权、settings 授权与 yolo。
- 验证：bun run check 通过（格式、lint、tsc -b、knip、全量 60 个测试）。code-review 两轴审查：规范审查修复一项祖先 .gitignore 遗漏后复查通过，0 项遗留；规格审查 0 项问题。

### 后续变更：内置 ripgrep

- 2026-10-01：按用户确认的 [内置 ripgrep 说明](../bundled-ripgrep.md)，grep 改用精确锁定的 @vscode/ripgrep@1.18.0，在调用时动态加载并通过 rgPath 的绝对路径执行。用户无需安装系统 rg，不回退 PATH，也不改变 bash 的 PATH。
- 平台包加载或二进制启动失败时，以“内置 ripgrep 不可用”及原始原因提示修复 Neant 的依赖或平台兼容性；现有 pi loop 将异常转为 isError，其他工具和 Run 可以继续。
- Seam 1 验证 PATH 不含 rg 时的搜索；Seam 2 验证 PATH 为空的真实 CLI 进程，以及通过 npm_config_arch 指向缺失平台包时 grep 报错、read 正常、模型收到错误并完成 Run。
- 实测范围为当前 macOS ARM64 / Bun 1.4.2，其他平台未验证；Bun 单文件和 Electron 打包不在本次范围内。
- 后续变更验证：`bun run check` 通过（格式、lint、`tsc -b`、knip、全量 62 个测试）；`/code-review` 规范审查与规格审查各 0 项问题。
