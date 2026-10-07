# 02: 全局展开与单卡展开

**What to build:** 用户按 `ctrl+o` 进入 transcript 模式，所有工具卡、thinking 与后台 job 组一起展开；点击单张卡片只切换这一张；hover 可点击卡片时整行高亮并出现 `▾ / ▴`。见 [spec](../spec.md) 的「TUI 工具卡」展开状态、按键与鼠标部分。

Blocked by: 01

Status: resolved

- [x] `ctrl+o` 切换全局展开，展开卡片、thinking 与 job 组；有交互、侧问、预览打开时忽略
- [x] 删除独立的 job 组展开状态，job 组折叠改读同一全局状态，相关提示文案更新
- [x] 点击卡片切换该卡展开；最终展开 = 全局展开 或 单卡展开；点击空白单元格不切换
- [x] hover 可点击卡片时整行 `toolCardBackground`、固定列 `▾`（展开为 `▴`），耗时 chip 与折叠提示提亮
- [x] 展开后正文最多 400 行窗口，并注明显示范围
- [x] 展开 / 折叠时保持阅读位置与 bottom-follow；小终端下不破坏布局
- [x] TUI e2e 覆盖以上行为；现有 Ctrl+O job 分组测试改为全局展开语义

## Answer

共享 chat `expanded` 控制工具卡、thinking 和 job 组；`expandedRows` 以工具调用 id / thinking anchor 记录单行状态，最终展开取并集。删除 `jobsExpanded`，保持原 Interaction、侧问、图片预览与小终端守卫。卡片悬停整行背景和固定状态列 disclosure，chip / 提示提亮；点击内容宽度内的头部、正文或提示切换单卡，尾部空白不激活。展开最多 400 行并显示范围；沿用稳定 ScrollBox anchors 和 following。

主对话新增 thinking 的 live / completed / resume 投影与折叠行，避免只改开关却丢弃推理内容。job 提示改为“展开全部”。保留 04 的 diff 行 tone/path 和 8 行折叠（普通文本 3 行）。

验证：先复现单卡不展开、thinking 不存在两项公开 terminal 行为失败，再实现通过。`env -u NO_COLOR bun test apps/neant-tui/tests/e2e/tools-and-notices.test.ts apps/neant-tui/tests/e2e/background-jobs.test.ts apps/neant-tui/tests/e2e/tool-expansion.test.ts` 27 pass / 9.65s；新 case 均 124–198ms。新增 resume case 50ms。合入 04 后 `env -u NO_COLOR bun test apps/neant-tui/tests/e2e/tool-expansion.test.ts apps/neant-tui/tests/e2e/file-diff.test.ts` 7 pass / 1.05s（单 case 51–193ms）。`bun run check:dev` 通过 format / lint / types / Knip。另 conversation 的公开 Session 保留 500 TPS scenario 通过（原集成成本 3.37s）；未改现有后台进程退出测试真实等待（2.15s / 3.27s）。合入依赖后首次缺 diff workspace 链接，重新 `bun install --frozen-lockfile` 后验证通过。完整 aggregate 由 integration 统一执行一次。

### Review 修复验证（2026-10-07）

- web Markdown 的正文点击通过 painted glyph 命中切换展开，空白单元格不触发。read 截断/继续读取 offset 与 bash 完整输出路径在折叠和 400 行窗口外持续显示。headless `tool-view-review.test.ts` 与 renderer `hover.test.tsx` 通过。
- `bun run check:dev` 通过；最终 aggregate 在 integration branch 统一执行，结果由 spec 验证记录补充。
