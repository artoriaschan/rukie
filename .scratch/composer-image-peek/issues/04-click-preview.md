# 04: 点击图片 token 预览并高亮

Status: resolved
Blocked by: 01, 02, 03

## Request

2026-10-07 用户要求补充：点击输入框绑定的 `[Image #N]` 显示现有被动预览，同时反色高亮该 token。Esc 后再次点击可以重开，输入、发送与图片绑定保留。

## Acceptance

- [x] 点击绑定 token 出卡并高亮，单个高亮随多图片点击切换。
- [x] Esc 后同一 token 重击可重开，输入及 Enter 发送正常。
- [x] 换行、中文/emoji 前缀与 resize 后点击准确；字面 token 不激活。
- [x] 待处理 Interaction 等现有拦截条件保持优先。
- [x] app start/headless terminal 回归及最终聚合检查通过，文档同步。

## Comments

原规格将点击列为范围外，本票由用户明确补充并授权。测试沿用规格已确认的公共接缝。

## Verification

公共行为先复现点击无卡，再实现 painted atomic glyph 命中与既有光标预览联动。相关 7 文件：50 pass / 0 fail，181 assertions，6.55s；新增三个点击场景均低于 300ms。`bun run check:dev` 退出 0。最终聚合检查结果记录于 review.md。
