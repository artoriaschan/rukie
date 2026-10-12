# 05：`--isolated` 验收模式与文档

Status: resolved

Blocked by: 01, 02, 03

**What to build:** 按 [spec](../spec.md#--isolated-验收模式) 为代理 agent-browser 验收提供一次性环境，并把验收入口写入规则文档。

- [x] `--isolated`：配置根与数据根在本次运行的临时目录，退出时删除；后端 `memory`；不访问系统钥匙串
- [x] 启动只监听 loopback 的 OpenAI 兼容 fake 端点，复用 `scripts/release/tests/provider-protocol.ts` 的协议回包；握手后经 `modelServices.save` 预置指向它的供应商与模型
- [x] 测试覆盖临时目录清理、fake 供应商预置、对话收到固定回复、退出后端口与目录释放
- [x] AGENTS.md 与 [testing.md](../../../docs/testing.md#原生验收授权边界) 中“mock DesktopHost / 模拟 DesktopHost”改为 `dev:desktop:web --isolated`；`test:desktop` 的 mock 边界不变
- [x] spec 的 ADR Coverage 与最终实现复核后关闭 spec

## 实施与验证记录

分支 `feat/desktop-web-isolated` 基于集成 `66a9c0e1`，由 implement_05 认领。使用已确认的启动器 CLI/路径与真实 Session wire seam；仅替换 loopback 模型网络对端和 Vite 进程（自动测试），memory 后端、供应商保存、Session 与持久化保持真实。主代理协调 aggregate 与最终浏览器验收，此代理只执行 focused TDD、受影响格式/类型/lint 和文档检查。spec 关闭及 ADR Coverage 最终复核归主代理。

实现 `webDevelopmentPaths(..., {isolated: true})` 与 CLI `--isolated`，临时根下包含 data/configuration；HOME 和 sidecar homeDir 也指向临时根。使用显式 memory 后端，复用非 spec helper `providerProtocol("openai-responses")` 的 loopback 回包。握手后以鉴权 wire `modelServices.save` 预置 `isolated` / `isolated-reply` 与 fabricated 凭证；保存连接关闭后才启动 Vite，避免抢占 UI 连接。退出按 Vite → sidecar → fake 顺序等待资源释放，再释放锁并删临时目录；若进程退出不能确认，保留目录与锁，仍停止 fake。取消预置操作时等待其 socket close。根 scripts 增加 `@rukie/shared: workspace:*` devDependency，直接引用准确的 WireCommand 类型。

TDD：第一轮 isolated 临时路径断言失败（原路径仍为 checkout 持久目录），实现后 1 pass/5 assertions；第二轮真实 sidecar 的 modelServices.list 返回空列表失败，预置后真实 Session 回复 `packaged protocol reply`，两个端口不可连接、临时目录不存在。仅网络模型对端和自动测试的 Vite 进程是 fake；不访问用户配置、系统钥匙串或 Electron。

验证状态为本票未提交实现差异（web.ts、isolated.ts、desktop-web.test.ts、根 workspace devDependency 与文档）：

- `rtk proxy bun test scripts/tests/desktop-web.test.ts`：13 pass，0 fail，51 assertions，2.03s。真实 sidecar+Session 场景 885.23ms；首次单例 1018.38ms，必需成本是 Bun sidecar 启动、SQLite/vault 保存、真实模型 HTTP streaming、Session 和进程组清理，没有固定 sleep。
- 生命周期后续仅增加预取消路径清理并把 fake stop 移至失败保护之前；`rtk proxy bun test scripts/tests/desktop-web.test.ts -t 'isolated launcher cancelled'`：1 pass，0 fail，2 assertions，103ms。此前服务接线证据继续有效。
- `rtk proxy bunx --no oxlint scripts/desktop/web.ts scripts/desktop/isolated.ts scripts/tests/desktop-web.test.ts`：通过。
- `rtk proxy bunx --no tsc -b scripts`：首次报根无法解析 @rukie/shared；补根 workspace devDependency 与 lock 后通过。依赖添加 CLI 首先遇到 shell glob 错误，引用后 registry typebox manifest 请求因证书失败；精确更新已有 workspace lock 条目并运行 `rtk proxy bun install --frozen-lockfile` 通过，未改变外部依赖版本。
- `rtk proxy bun run check:docs`：146 Markdown 文件通过。任务文件 oxfmt 与 diff check 完成；最终格式、lint、类型和 seed response type 窄校验的单例证据在提交前补入。

AGENTS.md 与 testing.md 的手工验收改为 `bun run dev:desktop:web --isolated`；自动 `test:desktop` 的 DesktopHost/Electron/safeStorage mock 边界保持。ui README 补充同一入口及固定回复。主代理实际浏览器验收使用命令输出的 fragment URL，并选择 `Isolated acceptance` / `Isolated reply`；关闭浏览器后停止启动器。最终 aggregate、GUI 与 ADR Coverage 复核及关闭本票/spec 由主代理统一完成。

提交前增量证据：seed 新增要求 `type === "response"`，使该 seam 先前证据失效，最小复验 `rtk proxy bun test scripts/tests/desktop-web.test.ts -t 'isolated launcher presets'` 1 pass，0 fail，8 assertions，1.212s（场景 1104.46ms，真实进程/Session 集成成本同上）。最终受影响 lint、scripts typecheck、check:docs 与 diff check 均通过。README 段落移至使用入口，沿用已验证行为。最终格式检查及提交 hooks 结果由提交输出确认。

## Comments

集成、双轴评审修复及适用本地验证已完成，与 spec 在本次状态提交统一 resolved。ADR Coverage 与静态、desktop 包级和 isolated Chromium 验收证据见 [spec 最终交付记录](../spec.md#最终交付与-adr-coverage-复核)。未访问真实钥匙串，PR 待用户评审，CI 待验收。
