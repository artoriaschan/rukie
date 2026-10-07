# 02: 全局展开与单卡展开

**What to build:** 用户按 `ctrl+o` 进入 transcript 模式，所有工具卡、thinking 与后台 job 组一起展开；点击单张卡片只切换这一张；hover 可点击卡片时整行高亮并出现 `▾ / ▴`。见 [spec](../spec.md) 的「TUI 工具卡」展开状态、按键与鼠标部分。

**Blocked by:** 01

**Status:** in-progress

- [ ] `ctrl+o` 切换全局展开，展开卡片、thinking 与 job 组；有交互、侧问、预览打开时忽略
- [ ] 删除独立的 job 组展开状态，job 组折叠改读同一全局状态，相关提示文案更新
- [ ] 点击卡片切换该卡展开；最终展开 = 全局展开 或 单卡展开；点击空白单元格不切换
- [ ] hover 可点击卡片时整行 `toolCardBackground`、固定列 `▾`（展开为 `▴`），耗时 chip 与折叠提示提亮
- [ ] 展开后正文最多 400 行窗口，并注明显示范围
- [ ] 展开 / 折叠时保持阅读位置与 bottom-follow；小终端下不破坏布局
- [ ] TUI e2e 覆盖以上行为；现有 Ctrl+O job 分组测试改为全局展开语义
