# 03：`modelServices.*` wire 命令与浏览器 host 模型服务

Status: resolved

Blocked by: 01

**What to build:** 按 [spec](../spec.md#wire-命令) 与 [ADR-0037](../../../docs/adr/0037-browser-host-sidecar-capabilities.md#模型服务通道)，在会话 WS 上提供模型服务命令，浏览器 host 用它们实现 `DesktopHost.modelServices`。

- [x] `@rukie/shared` 的 `WireCommandSchema` 新增 `modelServices.list / save / delete / test / revealKey / templates / prices`；`save` 凭证为 `keep`、`delete` 或 `replace` 明文
- [x] server 复用 `/private/model-services` 的处理逻辑，不复制；`replace` 明文立即经当前后端加密；`electron` 后端返回明确错误码拒绝
- [x] 明文与 `revealKey` 返回值不进入日志、snapshot、错误消息或模型上下文；client 与 store 不缓存
- [x] 浏览器 host 经 wire client 实现 `modelServices`，模型服务页面在浏览器中可用
- [x] server wire 测试覆盖 schema、后端拒绝、同事务保存与删除、明文不外泄；ui Chromium 测试用脚本化 wire server 覆盖浏览器模型服务流程
- [x] 更新 server、ui README 的命令与凭证通道说明

## Implementation evidence

Owner: ticket 03 implementer; pre-agreed seams: shared command parsing, authenticated public server WS, and Chromium App with scripted WS boundary. Root coordinates aggregate static/desktop and final isolated acceptance. TDD initial WS save red returned invalid_command; green case passed in 30.86 ms.

共用 `modelOperation` 保留 private HTTP 的操作/错误语义，wire replacement 先加密再调用相同保存事务；Electron 显式返回 `model_services_unavailable`。浏览器 `DesktopHost` 完整必需，App 始终显示设置入口，模型服务不再判断隐藏能力；host 复用 `bindClient` 唯一 WS，响应校验且不保存明文。测试 fixture 补齐相同接口，外部价格查询与真实凭证均未访问。

验证：`bun test packages/server/tests/server.test.ts packages/server/tests/wire.test.ts` 35/35，5.87 s；新增 save/keep/delete、后端拒绝、异常脱敏为 11–50 ms。snapshot 覆盖增补后 focused 用例 209.13 ms。Chromium host 文件 4/4，5.18 s；模型服务/shell/layout 34 个案例首跑 33/34，必需价格探测新增状态文案让旧标题断言失败，改为只断言标题文本节点，focused 回归通过（2.98 s）。host 全方法补充后 focused Chromium 通过（3.01 s）。这些 browser 时长来自真实 Chromium、脚本化 WS 子进程与顺序点击，无固定 sleep。`bunx --no tsc -b`、focused `oxlint`、oxfmt 和 `git diff --check` 通过。根代理复用上述有效证据并负责完整静态、desktop 包级和最终浏览器验收。

ADR Coverage review: 与 spec 的 ADR-0037 模型服务 WS / 后端拒绝边界、ADR-0031 鉴权命令及 ADR-0029 host→client 方向一致；复用现有数据库凭证事务与历史行为，不新增架构取舍。README 已同步当前凭证通道。保持 claimed，待集成评审与根代理适用验证后一起 resolved。

Chromium settings tracer 在基线 browserHost/App 下重放，缺少 Model services 按钮失败；恢复实现后上方 3.01 s green 证据有效。Snapshot 非泄露断言在仍保存凭证时执行，最终 focused green 155.26 ms。文档检查 146 Markdown 文件通过。

## Comments

集成、双轴评审修复及适用本地验证已完成，与 spec 在本次状态提交统一 resolved。ADR Coverage 与静态、desktop 包级和 isolated Chromium 验收证据见 [spec 最终交付记录](../spec.md#最终交付与-adr-coverage-复核)。未访问真实钥匙串，PR 待用户评审，CI 待验收。

### 追加修复：未配置地址时修改供应商名称

用户反馈在未配置 Base URL 时确认改名触发通用配置校验错误。Chromium 公共 ModelServices 入口先复现该错误（单例 972ms，完整 focused 命令 2.74s）；原因是改名无条件调用完整 persist，URL 校验发生在 host save 之前。改为待保存草稿只更新名称，已保存且无待保存修改的配置继续立即保存改名；名称复用 shared schema 并拒绝空白，不放宽正式保存的 URL、模型及密钥校验。已有地址和密钥草稿保留，不因改名提前提交或清空。仅修改 onSubmit 行为，没有 DOM、CSS、几何或组件来源变化；沿用 ADR-0037 的配置与凭证边界，无需新增 ADR。

验证状态：`6bf097e4` 后 ModelServices handler、两个 Chromium 回归案例与 ui README 差异。`rtk proxy env -u NO_COLOR bunx --no vitest run packages/ui/tests/app/model-services.browser.test.tsx -t 'renaming a'` 2 pass / 20 skipped（4.23s）；覆盖新草稿空地址改名、补地址后保存、已有配置改名持久化、空白名拒绝和保留待保存地址/key。首次 `--project ui-browser` 未匹配 root 的嵌套项目，属于 runner 启动失败；修正相同用例入口后得到准确 RED。测试中的 modal 查询曾因退出动画产生重复 Save 按钮，以及“不存在元素”无法使用 not-visible matcher 而失败；按真实 dialog 移除状态同步后通过，没有放宽行为断言。集成成本来自真实 Chromium 菜单、弹窗与顺序交互，无固定 sleep。

受影响 `oxlint`、`tsc -b packages/ui`、格式、146 文件 docs 与 414 文件 test-policy 通过。之前 desktop 128 项和 check:dev 的未受影响证据继续有效，没有因局部修复重跑包级或全量。实际 agent-browser 命名会话复验空地址新建供应商改名成功，无 alert；Light/Dark/640px 截图，窄屏无溢出，console 与已观察网络无错误。用户的 Vite PID 41418/5173 已在本 checkout 运行，未停止；通过任务外脚本调用 launchWebDevelopment 的隔离路径与生命周期桩复用它，只启动 memory/fake sidecar（真实 WS），未访问用户配置/凭证。曾有一个通用“无任何 dialog”等待条件因 App 的上下文弹窗仍存在超时；按目标改名结果核对成功。结束后任务浏览器、sidecar 和 fake 两个端口退出，隔离临时根为零，用户 Vite 保持运行。

日志与截图：`/tmp/rukie-desktop-web-evidence/rename-red.log`、`rename-green.log`、`rename-light.png`、`rename-dark.png`、`rename-narrow.png`、`rename-console.log`、`rename-network.log`。修复加入原 PR #17，最新 CI 状态由 PR checks 确认。
