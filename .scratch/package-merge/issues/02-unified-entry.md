# 02: 统一入口与参数

Status: resolved
Blocked by: 01

**What to build:** 新建 `src/main.ts` 和 `src/cli/`，用一份参数表解析并校验，然后按模式动态 import `headless/` 或 `tui/`。用法对齐 Claude Code。删除 `neant-cli` bin、`dev:cli` 和 `dev:tui`。见 [spec](../spec.md) 的"模式判定"。

- [x] `neant` 进入 TUI，`neant "q"` 进入 TUI 并发送首条 prompt
- [x] `neant -p "q"` 和 `echo q | neant -p` 走 Headless，输出、退出码与 stream-json 行为与原 Headless CLI 一致
- [x] `--goal` 走 Headless；`--goal` 与 `-p` 的冲突、`--max-goal-rounds` 校验保持原语义
- [x] 不带 `-p` 且 stdin 非 TTY 时退出码 2，并提示使用 `-p`
- [x] TUI 模式下用 `--output-format`、`--max-goal-rounds` 报参数错误
- [x] 参数错误按 locale 显示，zh 与 en 文案同步；删除 CLI 原有的英文常量
- [x] `-p` 模式不加载 `ink/` 和 react，有测试证明；`main.ts` 与 `cli/` 不静态导入 `tui/`、`ink/` 的 lint 规则做过负向验证
- [x] package.json 只有一个 bin `neant`；`src/index.ts` 导出 `main` 和 IO 类型；AGENTS.md、architecture.md 中的命令示例已更新
- [x] `env -u NO_COLOR bun run check` 通过

## Answer

新增公共 `main` 与 IO 类型，`cli/` 的一份参数表完成校验后动态加载 `runHeadless` 或 `runTui`。`-p` / `--print` 是布尔开关；位置参数为 prompt，print 缺省时读 stdin，Goal 不读 stdin。移除 `--prompt` 旧参数和 `neant-cli` bin；`dev` 与唯一的 `neant` bin 使用统一入口。Goal 与 print、Goal 与额外 prompt、仅限 Headless 的参数均在创建 Session 之前校验；非 TTY stdin 的 TUI 请求退出 2，stdout / dumb TERM 仍由 TUI 处理并退出 1。

共用 i18n 迁到 `view/i18n`，各消费者与源码中文扫描跟随更新，参数错误同步 zh / en。IO 支持终端流与 Headless callback sink；TUI 的 AbortSignal 接入已有关闭、Session 保存和终端恢复流程，提前 abort 不创建 Session／renderer，完成后移除 listener。

## Verification

- Red：公共入口尚不存在时测试失败；Goal + positional 测试复现被忽略的 prompt；预先 abort 的 TUI 测试复现不必要的渲染。修复后相应测试通过。
- 新增 public main 测试：27 pass / 0 fail，542ms。覆盖两种 print 写法、位置 prompt、stdin、allow-tools token 边界、Goal 冲突与 rounds、Headless-only 参数、非 TTY、双 locale、TUI 取消。
- Fresh child 中把 React 和 renderer 模块变为会抛错的 mock，print 仍成功；临时插入 eager React import 时同一测试失败（修改已还原）。子进程设置失败期限，并在 finally 终止且等到真实退出。
- 原 affected 集：263 pass，另有一个不再成立的旧 positional 拒绝用例；改为拒绝第二个多余 prompt 后，7 个 bad-argv 用例全通过（1.286s）。旧 Session／Goal、stream-json、resume、MCP、terminal 与 locale 场景继续经过公开统一入口验证。
- `bun run check:dev`、`git diff --check`、单 bin／包 exports 与当前文档相对目标检查通过。10 个 entry / cli 违规 static import 或 re-export 临时 fixtures 均被 lint 拒绝，fixtures 已删除；选中模式的 dynamic import 有局部说明性 lint 例外，因为锁定的 Oxlint 同样检查 dynamic import。
- 最终 `env -u NO_COLOR bun run check`：2768 pass / 0 fail / 226 files / 15602 assertions，87.83s。执行证据 `/tmp/neant-package-merge/02-final-check.log`；lint 证据 `/tmp/neant-package-merge/02-lint.log`。
