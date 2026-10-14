# 01：外壳三栏底色与工作区阴影

Status: ready-for-agent

**What to build:** 按 [spec](../spec.md#外壳三栏底色与工作区阴影)，把 C01 外壳的三栏底色更新为 DESIGN.md 中的新值，并给中间导航加主内容组成的内侧工作区加上两层外阴影，主页与设置页都生效，几何不变。

- [ ] 开始改动前运行 layout 浏览器测试，记录 layout preservation 基线
- [ ] 更新 `layout-rail`、`layout-titlebar`、`layout-sidebar`、`layout-content` 的 Light/Dark 值；`layout-divider` 不变
- [ ] 新增 `layout-shadow-near` / `layout-shadow-far`，只在内侧工作区容器上合成 `0 2px 8px` 与 `0 8px 24px` 两层外阴影，跟随 12px 圆角，位于外层窗口裁剪内
- [ ] 设置页显示同样的三栏底色与工作区阴影，设置内部作用域 token 不变
- [ ] layout 浏览器测试改为断言新底色，新增阴影断言（Light/Dark 两层值，只在工作区容器上）；几何断言保持不变并通过
- [ ] DESIGN.md 三栏底色与阴影段落与实现一致（当前分支已有修改），确认无遗漏
- [ ] 受影响页面的 agent-browser 截图：主页、会话、设置，Light/Dark 与窄宽度

## Comments
