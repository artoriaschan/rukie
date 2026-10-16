# 02：迁移 theme.css 语义 token

Status: ready-for-agent
Blocked by: 01

**What to build:** 让 `packages/ui/src/theme.css` 的取值符合 DESIGN.md 的 Shared token 表和 ticket 01 补齐的角色。实现依据是 [spec](../spec.md) 中「主题 token」一节。

## 授权差异（实施前在此表基础上补全）

| 区域       | 属性                                                    | 旧值                                    | 新值                              |
| ---------- | ------------------------------------------------------- | --------------------------------------- | --------------------------------- |
| 全局 Light | `foreground` / `primary`                                | `#262626` / `#000000`                   | `#171717` / `#171717`             |
| 全局 Light | `border`、`card-border`、`popover-border`               | `#0d0d0d1a`                             | `#ebebeb`                         |
| 全局 Light | `secondary` / `muted` / `surface`                       | `#e6e6e6` / `var(--card)` / `#0d0d0d08` | `#ffffff` / `#f5f5f5` / `#f5f5f5` |
| 全局 Light | `hover`、`surface-hover`                                | `#0d0d0d0d`                             | `#ececec`                         |
| 全局 Light | `selected` / `menu-hover`                               | `#0d0d0d0d` / `#f0f0f0`                 | `#f1f1f1`                         |
| 全局 Dark  | `background` / `card`、`input-surface`、`input-focused` | `#000000` / `#2b2b2b`                   | `#212121`                         |
| 全局 Dark  | `foreground` / `primary-foreground`                     | `#d4d4d4` / `#000000`                   | `#fafafa` / `#0a0a0a`             |
| 全局 Dark  | `popover`、`menu` / `secondary` / `muted`               | `#2b2b2b` / `#363636` / `#2b2b2b`       | `#2f2f2f` / `#282828` / `#2f2f2f` |
| 全局 Dark  | `surface` / `hover`、`surface-hover`                    | `#ffffff0d` / `#ffffff0d`、`#ffffff1a`  | `#282828` / `#343434`             |
| 全局 Dark  | `selected`、`menu-hover`、`border`                      | `#ffffff1a`、`#363636`、`#ffffff1a`     | `#3a3a3a`                         |
| 类型       | `text-ui-caption` 行高                                  | 20px                                    | 18px                              |

`layout-*`、`ansi-*`、`diff-*`、`find-highlight*`、`interaction-confirmation-*` 以及已通过对比度测量的文字和边框配对保持不变：`muted-foreground`、`foreground-subtlest`、`input-border(-hover)`、`ring`、`accent`。

## 任务

- [ ] 先列出直接或间接消费 `background`、`card`、`muted`、`secondary`、`surface` 的所有表面，按 ticket 01 的归属表重新绑定。结构表面改用 `layout-*` token，不要因为 token 取值变化而被带着一起变。
- [ ] Dark 取值只保留一份来源，`.dark` 和 System 偏好解析到同一组语义角色。保证首帧没有颜色闪烁。
- [ ] 删除 `--radius: 0.75rem`、`.glass`、`.glass-strong`、`.glass-thin` 和 `--glass-*`。先确认没有任何消费者。
- [ ] 新增 ticket 01 定义的覆盖层阴影和 composer 阴影角色，并接入现有覆盖层和 composer 的消费者。
- [ ] 删除原语中的 `leading-[1.5]` 覆盖，改由 `text-ui-*` 行高提供。如果某个原语需要特殊行高，改为在 ticket 01 中新增的具名角色。
- [ ] 在 Light 和 Dark 下，实测下列文字或标记在实际背景上的对比度，结果写入 Comments：`foreground`、`muted-foreground`、`foreground-subtlest`、`accent` 链接、`danger`、`success`、`warning`、`input-border`、`ring`。背景包括新的 `background`、`muted`、`surface`、`popover` 和 `selected`。普通文本至少 4.5:1，边框和状态指示至少 3:1。不达标时调整取值，并同步更新 DESIGN.md。
- [ ] 测试：
  - 在 `semantic-roles`、`layout`、`shell` 等现有套件中，按上表更新计算颜色断言，表外断言不动。
  - 新增一条用例，覆盖 System 主题和 `.dark` 解析到相同语义值。
  - 运行受影响文件；由于影响面覆盖全部屏幕，运行一次 `bun run test:desktop`。
- [ ] 运行 `bun run check:dev`。用 agent-browser 验收：在 Light、Dark 和 420px 宽度下截图对话、设置和菜单，检查控制台与网络无错误。
- [ ] 同步更新 `packages/ui/README.md` 中引用了旧取值的段落。

## Comments
