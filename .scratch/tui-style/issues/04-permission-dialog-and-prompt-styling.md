# 04: 权限对话框与输入框样式

**What to build:** 在 ② 层补上 `Divider`（`─` 铺满宽度，可带标题和颜色 token）、`ListItem`（聚焦时 `❯` 指针 + accent 加粗，未聚焦两格空白）、`HintLine`（subtle 色按键提示）。权限对话框改为：顶部 permission 色 Divider 带标题 `权限确认`，工具名与参数一行，三个选项用 ListItem，底部 HintLine。输入框改为上下两条 promptBorder 色 Divider，中间 `❯ ` + 输入。见 spec 的 ② ③ 节。

**Blocked by:** 03

**Status:** resolved

- [x] `Divider`、`ListItem`、`HintLine` 从 `@neant/tui` 导出
- [x] 冒烟测试：权限对话框渲染出 `─` 分隔线，聚焦项为 accent 色加粗
- [x] 方向键 / 1–3 / Enter / Esc 的权限交互行为不变（现有测试通过）
- [x] `bun run check` 全绿
- [x] 手动运行 `neant` 触发一次 ask，确认对话框与输入框视觉

## Comments

- 2026-10-02：新增并导出 Divider、ListItem、HintLine 及 props 类型。Divider 订阅终端宽度，以 truncate 保持标题与横线在一行，并裁切到容器宽度；ListItem 使用固定两列指针区域，避免普通文本换行吞掉未聚焦项的空白。聚焦项统一 accent 色加粗，HintLine 使用 subtle 色。
- 权限对话框使用 permission 色「权限确认」Divider、单行工具参数、三个 ListItem 和底部 HintLine。输入框改为两条 promptBorder 色 Divider 包围 `❯ ` 与原有 TextInput；仅修改展示层，键盘事件与权限状态模块保持原有行为。
- 沿用规格确认的 render + headless terminal seam，新增一条权限组件冒烟测试。先观察旧标题无分隔线的失败，再验证横线铺满、permission/accent/text/subtle 前景色、聚焦项粗体与未聚焦项两列缩进。现有入口、权限与 resume 测试只更新变化的字形断言；实现期间两次 `bunx tsc -b` 通过。
- 最终运行 `rtk proxy env NO_COLOR= bun run check`，格式、lint、类型检查、Knip 与全仓库测试通过：236 tests / 1271 assertions，0 failures。首次全量运行发现 resume 仍断言旧 `>` 字形，更新后单文件及全量重新通过。执行环境自带 NO_COLOR，颜色验收显式清空，原有 NO_COLOR 专项测试保持通过。
- 手动验收：在真实 PTY 中通过 neant main 入口 IO seam 固定 80×24，注入受控模型流，输入 prompt 后触发 bash ask，按 2 与 Enter 授权并执行真实 `printf permission-style-ok`。查看 ANSI 并用 headless terminal 读回，确认 permission 标题线、accent 加粗焦点、两列缩进、subtle 提示与恢复输入框的两条 promptBorder 横线。Ctrl+D 退出码 0、raw 模式恢复。另以临时 runner 验证受限容器宽度及终端缩窄/扩宽后的单行 Divider。未连接真实模型服务；runner 与 ANSI 记录位于 /tmp，未纳入仓库。
- code-review：以实施前 HEAD `b03365857d0d80f5d2b2d5c7b8ac604a1b25222a` 为基线，对暂存实现分别进行 Standards 与 Spec 独立审查，均为 0 项发现。
