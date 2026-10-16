# 03：设置页改用 theme 中具名的表面角色

Status: ready-for-agent
Blocked by: 02

**What to build:** 删除 `packages/ui/src/app/model-services.css` 第 1–32 行中对核心 token 的覆盖。现在这段代码在 `.model-services`、`.model-services-modal` 和 `.model-services-menu` 上，用写死的 hex 重新定义了 `--background`、`--foreground`、`--sidebar`、`--surface`、`--card`、`--popover`、`--popover-border`、`--danger`、`--border`、`--input-surface`、`--secondary`、`--secondary-foreground`。改为在 `theme.css` 中定义 `settings-*` 具名角色，取值采用 ticket 01 补齐的设置页表面值。依据是 [spec](../spec.md) 的「主题 token」一节。

## 授权差异（实施前补全）

| 区域                 | 属性        | 旧值（Light / Dark）                         | 新值                             |
| -------------------- | ----------- | -------------------------------------------- | -------------------------------- |
| 设置画布             | 背景        | `#f8f8f8` / `#161616`                        | ticket 01 的设置画布             |
| 设置导航列           | 背景        | `#f0f0f0` / `#161616`                        | ticket 01 的设置导航             |
| 设置卡片、弹层与菜单 | 背景与边框  | `#fff`、`#0d0d0d1a` / `#2b2b2b`、`#ffffff1a` | 共享 `card`、`popover`、`border` |
| 字面字号             | `font-size` | 666 行 10px，1190 行 16px，1195 行 14px      | 对应的 `text-ui-*` 角色          |

以下规范点名的几何不变：

- 880px 工作区，其中 224px provider 栏、656px 详情区。
- 字段高 32px、圆角 8px。
- 模型对话框：最大宽 672px，最大高 704px，标题区 82px，底栏 60px。
- 68px 的 provider 卡片，间距 10px，窄窗口下单列。

## 任务

- [ ] 在 `theme.css` 中新增 `settings-*` 角色，明暗各一组。设置页只消费这些角色和共享 token，不再在局部覆盖核心 token。
- [ ] 把 `model-services.css`、`worktree-settings.css` 中其余的 hex 字面值改为 token。
- [ ] 把字面 `font-size` 改为 `text-ui-*`。如果 CSS 中无法直接使用 utility，引用对应的 `--text-ui-*` 变量。
- [ ] 测试：在 `model-services` 和 `worktree-settings` 的 browser 套件中，按上表更新颜色断言。规范点名的设置页几何断言必须全部保持不变。
- [ ] 运行受影响的文件，加上变更文件的 lint、format 和类型检查。用 agent-browser 验收设置页：Light、Dark 各一张截图，再加 420px 宽度。

## Comments
