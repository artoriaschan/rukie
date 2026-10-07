# 03: 抽出 view 层并加依赖边界

Status: resolved
Blocked by: 02

**What to build:** 把与终端无关的呈现逻辑从 `tui/` 移到 `src/view/`，再用 lint 固定 `headless/`、`tui/`、`view/` 的依赖方向。见 [spec](../spec.md) 的"目录"和"依赖方向"。

迁移清单：

- `view/conversation/`：`screens/chat/conversation.ts`、`completed-visibility.ts`、`subagents.ts`、`activity/`
- `view/commands/`：`screens/chat/commands.ts`
- `view/transcript/`：`screens/chat/transcript-search.ts`、`components/tool-call/presentation.ts`、`diff-lines.ts`、`components/subagent-message/presentation.ts`、`job-card/output.ts`、`status-line/metrics.ts`；并从组件文件中拆出 `markdownProjection`/`markdownText`、`jobCardRows`、`contextText`
- `view/i18n/`：`tui/i18n/` 整体移入
- 留在 `tui/`：`composer-images.ts`、`mcp-commands.ts`、`logo/`

- [x] 迁移完成后 `view/` 不导入 react、`ink/`、`tui/` 和 Node API；`conversation.ts` 的 `basename` 改为字符串切片，并加 `ponytail:` 注释说明不处理 Windows 分隔符
- [x] `tui/` 用到 `alignSplitDiff` 等 ink 能力的位置，只经 `ink/index.ts` 导入
- [x] `image-gallery` 的 `inspectImage` 调用上移到 screen，`tui/components` 对 agent 只做类型导入
- [x] spec 中各条依赖方向规则都已加入 `.oxlintrc.json`，每条做过负向验证
- [x] 测试随源码移到 `tests/view/`；architecture.md 的 UI 分层一节改为新分层
- [x] `env -u NO_COLOR bun run check` 通过

## Answer

终端无关的 conversation、activity、commands、Transcript 搜索、Tool View / subagent / job / context 呈现迁入 `view/`；纯逻辑测试随源码迁移，TUI 场景仍通过公开启动入口验证。Markdown 的 React 部件归 TUI components，解析、数学与 Mermaid 文本投影归 view；ink 保留通用终端原语与代码框。i18n 已在 02 迁入 view，本票补齐其测试迁移与中文扫描路径。

screen 将 Agent Core 原有的 Session Notice decoder、Hook Notice 和思考时长 helper 传给 conversation，保留唯一的持久化事实读取路径；view 对 Agent Core 仅依赖类型。diff 接收可选语法高亮 helper，TUI 通过 `ink/index.ts` 提供完整源高亮与 split 对齐。screen 读取并缓存图片 metadata，gallery 与 preview 只消费图片事实；components 对 Agent Core 仅导入类型。conversation 使用 POSIX 字符串切片提取图片名，`ponytail:` 注释记录不处理 Windows 分隔符的限制。

依赖规则覆盖 Headless 不加载终端层、components / view 的 Agent Core 类型边界、view 无 React / terminal / Node API、ink 无上层与 Agent Core / locale、包内无自引用及 Agent Core 无 Frontend 依赖。Node builtin 列表来自当前安装运行时；ink 的逐层路径约束覆盖当前目录与 depth 3 / 4 的逃逸验证。architecture、根 AGENTS 与两份 renderer / TUI README 同步职责与链接。

## Verification

- 纯搬迁保留既有公开行为覆盖：view 33 pass / 0 fail，251ms；组件 154 pass / 0 fail，7.35s。
- 补齐 activity 测试迁移后的 view + 公开图片 / preview / Transcript 搜索 / Session recovery / Tool View / Context 场景：143 pass / 0 fail / 12 files / 3034 assertions，22.68s。证据 `/tmp/neant-package-merge/03-focused-view-e2e.log`。单文件超过 1s 的场景承担真实 Session、终端绘制、持久化与子进程生命周期，无新增固定等待。
- 33 个临时 import / re-export / Node global probes 全部符合预期，覆盖每条依赖规则、混合 Agent Core 类型与运行时导入、两种合法 type-only 写法、合法 `ink/index.ts` 和深层 ink 内部导入。违规目录、扩展名、私有 ink、裸 Node builtin、`node:`、depth 3 / 4 上层逃逸均被拒绝；fixtures 已删除。证据 `/tmp/neant-package-merge/03-lint.log`。
- `bun run check:dev` 的 format / lint / types / Knip / scratch 检查通过；变更文档的全部相对目标存在，`git diff --check` 通过。
- 最终 `env -u NO_COLOR bun run check`（隔离 HOME）：2772 pass / 0 fail / 227 files，88.97s；format / lint / types / Knip / scratch 同时通过。证据 `/tmp/neant-package-merge/03-final-check.log`。Markdown 子任务先合入 integration，本票工作分支已吸收该提交；最终 gate 使用完整 03 代码状态。
