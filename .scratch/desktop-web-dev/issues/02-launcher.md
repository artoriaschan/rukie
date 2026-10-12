# 02：`dev:desktop:web` 启动器

Status: resolved

Blocked by: 01

**What to build:** 按 [spec](../spec.md#启动器) 新增根脚本 `dev:desktop:web` 与 `scripts/desktop/web.ts`，一条命令启动源码 sidecar（`--dev`、`system-keychain`）与 Vite dev server，打印带握手 fragment 的地址。

- [x] 取得 `.desktop-dev/web/launcher.lock`；已有实例时拒绝启动
- [x] 数据根 `.desktop-dev/web/data`；配置根为用户级 `Rukie Web Development/configuration`（macOS / Linux / Windows 路径见 spec）；路径与父目录拒绝符号链接，复用 `scripts/desktop/development.ts` 的检查
- [x] 拒绝继承会改变 sidecar 行为的环境变量，规则与 `developmentEnvironment` 一致
- [x] sidecar stdout 管道读取 `{port, token}` 握手，有界超时；超时打印 stderr 后退出
- [x] 握手后启动 Vite（固定 `localhost:5173`，占用即退出），打印 URL；`--open` 用系统默认浏览器打开
- [x] SIGINT/SIGTERM 按 Vite → sidecar 顺序停止并等待实际退出，再释放锁；任一子进程意外退出时停止另一个并以非零码退出
- [x] `--reset` 只清空 `.desktop-dev/web/data`
- [x] `scripts/tests/` 用桩子进程覆盖上述行为，以输出与退出事件同步，不用固定 sleep
- [x] 更新 ui README 与 desktop README 的浏览器开发入口

## Answer

实现 `scripts/desktop/web.ts` 与根 `dev:desktop:web`，复用 developmentEnvironment、独占锁、逐级目录/持久化树检查与进程组退出确认。sidecar 源码以 `--dev` 启动，显式 `system-keychain` / `Rukie Web Development`；Vite 严格固定 localhost:5173，握手与 Vite 就绪后输出 fragment URL。取消、启动失败和两种服务崩溃均等待实际退出；先停 Vite 后停 sidecar，再释放锁。配置按 macOS/Linux/Windows 用户应用数据目录共享，web data 与 Electron data 分开；reset 保留配置。ui/desktop README 已更新。

测试 seam 沿用 spec 的启动器进程边界：实际桩子进程、输出/close 同步，独立临时 home 与 checkout，不触碰用户配置、系统钥匙串或 Electron。TDD 首轮缺少 web.ts 失败，路径实现通过；启动器导出缺失失败后通过；真实 SIGINT seam 的 runWebDevelopment 导出缺失失败后通过。后续覆盖锁、环境拒绝、reset、非法握手、超时 stderr、Vite 启动失败、sidecar/Vite 就绪后崩溃及浏览器 dispatch。握手超时用 250ms 实时时间验证实际子进程传输合同，其余就绪与退出只通过输出和 close 同步。

- `rtk proxy bun test scripts/tests/desktop-web.test.ts scripts/tests/desktop-development.test.ts`：21 pass，0 fail，87 assertions，1.446s；新用例最大 296.11ms，没有超过一秒的用例。共享目录检查与锁错误文案变化因此同时复验既有 Electron 开发测试。
- `rtk proxy bunx --no oxlint scripts/desktop/web.ts scripts/desktop/development.ts scripts/tests/desktop-web.test.ts`：通过。
- `rtk proxy bunx --no tsc -b scripts`：通过。
- 对任务文件运行 oxfmt；格式检查与 diff check 在提交前完成。集成 `check:dev`、`check:docs` 与后续 isolated 浏览器验收由主代理统一执行；没有在子代理重复包级或全量验收。真实钥匙串与默认浏览器未运行。

本票沿用 spec 的 ADR Coverage，启动器编排没有额外长期架构决定。为 05 保留的接口是 launchWebDevelopment 的已解析 paths、AbortSignal 与进程参数向量，runWebDevelopment 拥有真实 CLI 信号生命周期；05 可在此入口提供临时目录并扩展 memory 后端，不在本票实现 isolated。
