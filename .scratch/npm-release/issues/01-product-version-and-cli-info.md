# 01：产品版本与 CLI 信息入口

Status: resolved
Blocked by: None

## What to build

用户无需配置模型或启动 Session，即可通过 rukie 的 help/version 入口了解用法和准确的产品版本。维护者只维护一个 coding-agent 产品版本，应用请求中的版本信息与之保持一致。

## Acceptance criteria

- [x] 建立初始为 0.1.0 的唯一产品版本来源；内部 workspace 包继续私有，不引入独立发布生命周期。
- [x] help/version 在无 TTY、无 provider 凭据时退出 0，不初始化 Session、不读取或写入真实用户设置与 Sessions。
- [x] 共用参数解析定义 help/version 与其他参数组合的确定行为，未知参数和不合法组合保留正确错误与退出状态。
- [x] help 和相关错误同时提供中英文文案，用法与实际 Headless CLI/TUI 行为一致。
- [x] 应用的版本输出和请求版本信息一致；Agent Core 通过内部接口获得应用版本，不反向导入 Frontend。
- [x] 通过公开 main/命令入口覆盖输出、退出码和无 Session 副作用，并保留共用入口与动态 Frontend 加载的既有回归。
- [x] 更新命令使用说明，记录实际测试结果及版本注入的调用方义务。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 7–9、21、26。架构与范围沿用父规格 ADR Coverage；不处理 Yoga。

## Comments

- 2026-10-07：用户确认九张纵向工单拆分。无前置工单，可立即开始；当前仅发布工单，未实施。

- 2026-10-09：完成。coding-agent manifest 建立产品版本 0.1.0；共用 main 提前返回中英文 help/version（含 -h/-v），严格要求信息标志单独使用；无 TTY、无凭据，既不读取 stdin 也不开 Session。未知选项、缺值、非法 boolean 和组合错误保持退出2。
- 版本通过 SessionOptions.applicationVersion 注入父／子 web_fetch 和 MCP 初始、重连、OAuth 后连接；Agent Core 不再读取内部包版本作为产品身份。未提供版本的独立宿主明确使用无版本身份；Headless／TUI 强制使用 coding-agent manifest。更新 Headless 使用说明和 Agent Core 调用方义务。
- TDD：公开 main 的信息请求原先退出2，修复后退出0；公开 Session 的 HTTP User-Agent 原先 Rukie/0.0.0，修复后 Rukie/0.1.0；MCP initialize 原先硬编码0.1.0，注入9.8.7后返回9.8.7。补充子代理请求、双语非法组合、实际子进程无用户设置／Session副作用验证。
- 验证：env -u NO_COLOR bun test packages/coding-agent/tests/main.test.ts packages/coding-agent/tests/headless packages/agent/tests/e2e/web-fetch.test.ts packages/agent/tests/e2e/mcp.test.ts packages/agent/tests/e2e/mcp-oauth.test.ts：281 pass / 0 fail，10文件，33.25秒。新信息子进程用例约0.32秒；请求身份用例小于0.15秒。现有多进程 Headless/OAuth 组合的真实进程与协议成本保留。
- 静态及文档：bunx --no -- tsc -b、oxlint、knip、oxfmt --check，bun run docs:update、check:docs、check:scratch，git diff --check，bun install --frozen-lockfile 全部通过。全量 check 由集成分支统一执行；本票未运行全量检查。
- ADR coverage：沿用 ADR-0023 产品版本唯一来源及私有内部包边界、ADR-0012 共用参数与动态 Frontend 加载；无反向依赖或新执行路径，无新增决定。此证据只覆盖源码入口；真实安装包、CI 与 npm 发布由后续票验收。
