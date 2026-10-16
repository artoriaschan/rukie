# 03：设置页改用 theme 中具名的表面角色

Status: resolved
Blocked by: 02

**What to build:** 删除 `packages/ui/src/app/model-services.css` 第 1–32 行中对核心 token 的覆盖。现在这段代码在 `.model-services`、`.model-services-modal` 和 `.model-services-menu` 上，用写死的 hex 重新定义了 `--background`、`--foreground`、`--sidebar`、`--surface`、`--card`、`--popover`、`--popover-border`、`--danger`、`--border`、`--input-surface`、`--secondary`、`--secondary-foreground`。改为在 `theme.css` 中定义 `settings-*` 具名角色，取值采用 ticket 01 补齐的设置页表面值。依据是 [spec](../spec.md) 的「主题 token」一节。

## 授权差异（实施前补全）

| 区域                             | 属性       | 旧值（Light / Dark）                                                                 | 新值（Light / Dark）                                                                                                                                          |
| -------------------------------- | ---------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设置画布                         | 背景       | 最终 `layout-content`：`#ffffff` / `#000000`（局部旧覆盖另含 `#f8f8f8` / `#161616`） | `settings-canvas`：`#fafafa` / `#1a1a1a`                                                                                                                      |
| 设置分类列、provider 栏          | 背景       | 分类列 `layout-sidebar`：`#fcfcfc` / `#050505`；provider 透明                        | `settings-navigation`：`#ffffff` / `#212121`                                                                                                                  |
| 设置卡片                         | 背景、边框 | `#ffffff`、`#0d0d0d1a` / `#2b2b2b`、`#ffffff1a`                                      | `settings-card`、`settings-border`：`#ffffff`、`#ebebeb` / `#212121`、`#3a3a3a`                                                                               |
| 设置弹窗、菜单                   | 背景、边框 | `#ffffff`、`#0d0d0d1a` / `#2b2b2b`、`#ffffff1a`                                      | `settings-popover` / `settings-menu`、`settings-border`：`#ffffff`、`#ebebeb` / `#2f2f2f`、`#3a3a3a`                                                          |
| 嵌套选项卡、供应商目录卡片       | 背景       | 透明文字混色 / `#ffffff0d`                                                           | `settings-surface`：`#f5f5f5` / `#2f2f2f`                                                                                                                     |
| 设置文字、字段、状态、选择与交互 | 颜色       | 局部 foreground、danger、input-surface、secondary 等覆盖                             | 直接共享角色：foreground `#171717` / `#fafafa`，字段 `#ffffff` / `#212121`，选择 `#f1f1f1` / `#3a3a3a`，hover `#ececec` / `#343434`；其余共享 token 按 DESIGN |
| 设置遮罩                         | 背景       | `#26262633` / `#ffffff26`                                                            | 共享 `overlay`：`#26262633` / `#d4d4d433`                                                                                                                     |
| 模型元数据、空态标题、空态正文   | 字号       | 10px、16px、14px                                                                     | `text-ui-xs`、`text-ui-lg`、`text-ui-base`（14px 基准取值相同）                                                                                               |
| 工作树 repository 标签           | 字号       | `ui-font-size * 13/14`                                                               | `text-ui-caption`（14px 基准均为 13px；18px 基准为 17px）                                                                                                     |

以下规范点名的几何不变：

- 880px 工作区，其中 224px provider 栏、656px 详情区。
- 字段高 32px、圆角 8px。
- 模型对话框：最大宽 672px，最大高 704px，标题区 82px，底栏 60px。
- 68px 的 provider 卡片，间距 10px，窄窗口下单列。

## 任务

- [x] 在 `theme.css` 中新增 `settings-*` 角色，明暗各一组。设置页只消费这些角色和共享 token，不再在局部覆盖核心 token。
- [x] 把 `model-services.css`、`worktree-settings.css` 中其余的 hex 字面值改为 token。
- [x] 把字面 `font-size` 改为 `text-ui-*`。如果 CSS 中无法直接使用 utility，引用对应的 `--text-ui-*` 变量。
- [x] 测试：在 `model-services` 和 `worktree-settings` 的 browser 套件中，按上表更新颜色断言。规范点名的设置页几何断言必须全部保持不变。
- [x] 运行受影响的文件，加上变更文件的 lint、format 和类型检查。用 agent-browser 验收设置页：Light、Dark 各一张截图，再加 420px 宽度。

## Comments
