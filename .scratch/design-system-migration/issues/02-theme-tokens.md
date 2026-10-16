# 02：迁移 theme.css 语义 token

Status: resolved
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

`layout-*`、`ansi-*`、`diff-*`、`find-highlight*`、`interaction-confirmation-*` 以及已通过对比度测量的文字和边框配对保持不变：`muted-foreground`、`foreground-subtlest`、`input-border(-hover)`、`ring`。Dark accent 在新 selected 背景实测不达标，按本票任务要求同步修订规范与取值。

### 实施前补全的授权与影响面

| 区域                                            | 属性                                           | 旧值                                               | 新值                                                                        |
| ----------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| Conversation scoped palette                     | foreground/menu/hover/border and composer fill | legacy local hex overrides                         | shared semantic roles; composer `background`, overlays `menu`               |
| Generic overlays and scoped conversation panels | elevation                                      | shadow-md / drop-shadow-md / `0 4px 6px #0000001a` | named `shadow-overlay`                                                      |
| Composer                                        | elevation                                      | none                                               | named `shadow-composer`                                                     |
| Primitive typography                            | line height override                           | `leading-[1.5]`                                    | owning `text-ui-*` role (base 20px, caption 18px, sm 16px at 14px UI scale) |
| Dark destructive menu highlight                 | destructive-soft-foreground                    | `#ff7a7a`                                          | `#ff9595` to preserve 4.5:1 over composited highlighted popover             |
| Question/plan-review Interaction surface        | scoped bg-input-surface                        | input-surface                                      | shared muted per ownership table; geometry unchanged                        |
| Status/link text after contrast measurement     | Dark danger / accent                           | `#f85149` / `#4493f8`                              | `#ff7a7a` / `#70b0ff`; DESIGN updated with measured accessible values       |

直接消费表面：Plan body/header `background`；summary、attachment、Tool Approval、connection status `card`；plan preview `input-surface`；user bubble、Approval Card、Markdown/code/technical nested groups `muted`；badges/switch/worktree/Goal controls `secondary`；Goal/new-chat selector `surface`。间接别名：background-alt→card；background-win-alt/header/panel/sidebar→background；toast/tooltip/menu→popover；tooltip-tag/tag→muted；idle-task-surface 混入 background。通用覆盖层沿用 menu/popover；菜单、Select、Tooltip、Dialog 与 scoped conversation overlays 接入共享阴影。结构 owner 已使用 layout-rail/titlebar/sidebar/content；Home 导航动作的旧 bg-background 与窄屏遮罩改为 layout-content，Transcript 保持透明。设置页局部 token 覆盖由 03 删除，本票不改其几何或局部设置色板。ANSI/diff/find/confirmation 与 layout 值保持原样。

测试 seam 沿用 spec 预先确认的 rendered browser geometry/styles/interactions。无新增组件或依赖；复用已安装 beUI 与 shadcn 原语。

## 任务

- [x] 先列出直接或间接消费 `background`、`card`、`muted`、`secondary`、`surface` 的所有表面，按 ticket 01 的归属表重新绑定。结构表面改用 `layout-*` token，不要因为 token 取值变化而被带着一起变。
- [x] Dark 取值只保留一份来源，`.dark` 和 System 偏好解析到同一组语义角色。保证首帧没有颜色闪烁。
- [x] 删除 `--radius: 0.75rem`、`.glass`、`.glass-strong`、`.glass-thin` 和 `--glass-*`。先确认没有任何消费者。
- [x] 新增 ticket 01 定义的覆盖层阴影和 composer 阴影角色，并接入现有覆盖层和 composer 的消费者。
- [x] 删除原语中的 `leading-[1.5]` 覆盖，改由 `text-ui-*` 行高提供。如果某个原语需要特殊行高，改为在 ticket 01 中新增的具名角色。
- [x] 在 Light 和 Dark 下，实测下列文字或标记在实际背景上的对比度，结果写入 Comments：`foreground`、`muted-foreground`、`foreground-subtlest`、`accent` 链接、`danger`、`success`、`warning`、`input-border`、`ring`。背景包括新的 `background`、`muted`、`surface`、`popover` 和 `selected`。普通文本至少 4.5:1，边框和状态指示至少 3:1。不达标时调整取值，并同步更新 DESIGN.md。
- [x] 测试：
  - 在 `semantic-roles`、`layout`、`shell` 等现有套件中，按上表更新计算颜色断言，表外断言不动。
  - 新增一条用例，覆盖 System 主题和 `.dark` 解析到相同语义值。
  - 运行受影响文件；由于影响面覆盖全部屏幕，运行一次 `bun run test:desktop`。
- [x] 运行 `bun run check:dev`。用 agent-browser 验收：在 Light、Dark 和 420px 宽度下截图对话、设置和菜单，检查控制台与网络无错误。
- [x] 同步更新 `packages/ui/README.md` 中引用了旧取值的段落。

## Comments

### 实施与验证（2026-10-16）

- 基线 `c404c333`，实现共享色板、单一 `@variant dark` 声明来源、System 首帧/显式主题一致、删除无消费者的 rem radius 与 glass 工具/token。所有 ANSI/diff/find/confirmation 与 layout 值保留。
- 原语移除 `leading-[1.5]`，caption 使用 18px 行高；覆盖层接入 `--shadow-overlay`，composer 接入 `--shadow-composer`。形变 Popover 在实际圆角表面应用 box shadow，避免把带 spread 的配方误作 filter。
- 共享与间接消费者盘点见授权表；Conversation 局部旧 foreground/menu/border 覆盖移除，Question/Plan Review adapter 改绑 muted，主画布保留 layout-content。未更改几何断言。设置的局部色板由 ticket 03 迁移。
- TDD RED：semantic-roles 2 failed / 4 passed，1.93s；GREEN 最终包含共享表面、对比度、System/显式 Dark 和实际 composer/Select elevation。Focused 修复组 6 files / 53 tests passed，3.76s；原有 layout/shell/summary/compact 基线通过并复用。
- `bun run test:desktop` **原始结果 10 failed / 348 passed，5 failed / 58 passed files，26.96s**。失败均为已授权的旧颜色断言，集中修正后仅重跑五个受影响文件：72 tests / 5 files passed，20.22s。未把原始整包失败改称整包通过；组合证据覆盖全部 358 cases。新用例均低于 1s，未新增真实等待。
- `bun run check:dev` 的 docs:update、format、lint、types、Knip 通过；tracker 因重复 Status 行失败。修正为单行 claimed 后，增量 check:scratch、check:docs、check:ink-boundaries、check:test-policy、check:ui-typography、变更格式与 diff 检查全部通过。日志与逐轮失效范围在外部 `verification-02.md`，没有重复整包运行。
- agent-browser 隔离验收：1280×900 Light/Dark 和 420×900 Dark 的 conversation/settings/menu 共九张截图；实际 computed composer/bubble/layout/menu/shadow、pointer cursor、禁用 cursor、菜单方向键/Esc、窄屏 scrollWidth 均检查。无页面错误，控制台仅 Vite/React 信息，161 条资源请求均 200。关闭命名浏览器与启动器并等待进程退出；不启动 Electron、不访问钥匙串。设置页保留待 ticket 03 迁移的局部色板。
- 浏览器起初因 localhost IPv6 指向无关现有 Vite，截图被判无效；用 Chromium `--host-resolver-rules=MAP localhost 127.0.0.1` 后核对当前源码 class/计算颜色，九张同名截图全部重新生成。无关进程保留。浏览器附件与日志位于外部 `/tmp/rukie-design-system-migration-e22f975a/02-*`，完整验证记录供后续票复用。
- ADR coverage：沿用 spec 中 ADR-0029 与无需 ADR 的 token/原语决定；本票没有更改包边界、协议、宿主权限、持久化或引入依赖。

### 实测对比度

下表来源于隔离 Chromium 中实际解析的 shared token，使用 computed foreground/background 计算 WCAG 相对亮度；`semantic-roles` 同时以渲染表面覆盖相同配对。普通文字（含状态文字）阈值 4.5:1，input-border/ring 阈值 3:1；所有配对达标。card 等同 background；Light secondary 等同 background，Dark secondary 等同 surface。Dark accent/danger 已按 selected 最差背景修正；危险菜单透明高亮后的实际复合对比度由 F01 交互测试验证 ≥4.5:1。

Light：

| Role                  | background | muted    | surface  | popover  | selected |
| --------------------- | ---------- | -------- | -------- | -------- | -------- |
| `foreground`          | 17.928:1   | 16.444:1 | 16.444:1 | 17.928:1 | 15.872:1 |
| `muted-foreground`    | 5.742:1    | 5.267:1  | 5.267:1  | 5.742:1  | 5.084:1  |
| `foreground-subtlest` | 5.329:1    | 4.888:1  | 4.888:1  | 5.329:1  | 4.718:1  |
| `accent`              | 5.192:1    | 4.762:1  | 4.762:1  | 5.192:1  | 4.597:1  |
| `danger`              | 5.244:1    | 4.810:1  | 4.810:1  | 5.244:1  | 4.643:1  |
| `success`             | 5.421:1    | 4.972:1  | 4.972:1  | 5.421:1  | 4.799:1  |
| `warning`             | 5.100:1    | 4.678:1  | 4.678:1  | 5.100:1  | 4.515:1  |
| `input-border`        | 3.949:1    | 3.623:1  | 3.623:1  | 3.949:1  | 3.497:1  |
| `ring`                | 4.742:1    | 4.349:1  | 4.349:1  | 4.742:1  | 4.198:1  |

Dark：

| Role                  | background | muted    | surface  | popover  | selected |
| --------------------- | ---------- | -------- | -------- | -------- | -------- |
| `foreground`          | 15.427:1   | 12.827:1 | 14.125:1 | 12.827:1 | 10.898:1 |
| `muted-foreground`    | 6.931:1    | 5.763:1  | 6.346:1  | 5.763:1  | 4.896:1  |
| `foreground-subtlest` | 6.772:1    | 5.630:1  | 6.200:1  | 5.630:1  | 4.784:1  |
| `accent`              | 7.164:1    | 5.957:1  | 6.559:1  | 5.957:1  | 5.061:1  |
| `danger`              | 6.377:1    | 5.302:1  | 5.839:1  | 5.302:1  | 4.505:1  |
| `success`             | 6.867:1    | 5.710:1  | 6.287:1  | 5.710:1  | 4.851:1  |
| `warning`             | 6.847:1    | 5.693:1  | 6.269:1  | 5.693:1  | 4.837:1  |
| `input-border`        | 4.542:1    | 3.777:1  | 4.159:1  | 3.777:1  | 3.209:1  |
| `ring`                | 6.772:1    | 5.630:1  | 6.200:1  | 5.630:1  | 4.784:1  |
