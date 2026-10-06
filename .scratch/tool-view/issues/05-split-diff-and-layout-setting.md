# 05: split diff 与 diffLayout 设置

**What to build:** 宽终端上 diff 以左右分栏呈现，用户可用 `diffLayout` 设置强制 unified 或 split。见 [spec](../spec.md) 的「设置」与「渲染组件」。

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] 用户设置新增 `diffLayout: auto | unified | split`，默认 `auto`，按现有 settings schema 校验
- [ ] `auto` 下终端宽度 ≥110 列用 split，否则 unified；resize 跨阈值时切换
- [ ] split 两栏按 `diff` 包对齐，带词级高亮，长行截断不换行
- [ ] `unified` / `split` 强制值生效
- [ ] TUI e2e 覆盖阈值、resize 切换与强制值；小终端不破坏布局
