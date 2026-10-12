# 02：`dev:desktop:web` 启动器

Status: ready-for-agent

Blocked by: 01

**What to build:** 按 [spec](../spec.md#启动器) 新增根脚本 `dev:desktop:web` 与 `scripts/desktop/web.ts`，一条命令启动源码 sidecar（`--dev`、`system-keychain`）与 Vite dev server，打印带握手 fragment 的地址。

- [ ] 取得 `.desktop-dev/web/launcher.lock`；已有实例时拒绝启动
- [ ] 数据根 `.desktop-dev/web/data`；配置根为用户级 `Rukie Web Development/configuration`（macOS / Linux / Windows 路径见 spec）；路径与父目录拒绝符号链接，复用 `scripts/desktop/development.ts` 的检查
- [ ] 拒绝继承会改变 sidecar 行为的环境变量，规则与 `developmentEnvironment` 一致
- [ ] sidecar stdout 管道读取 `{port, token}` 握手，有界超时；超时打印 stderr 后退出
- [ ] 握手后启动 Vite（固定 `localhost:5173`，占用即退出），打印 URL；`--open` 用系统默认浏览器打开
- [ ] SIGINT/SIGTERM 按 Vite → sidecar 顺序停止并等待实际退出，再释放锁；任一子进程意外退出时停止另一个并以非零码退出
- [ ] `--reset` 只清空 `.desktop-dev/web/data`
- [ ] `scripts/tests/` 用桩子进程覆盖上述行为，以输出与退出事件同步，不用固定 sleep
- [ ] 更新 ui README 与 desktop README 的浏览器开发入口
